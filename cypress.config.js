const { defineConfig } = require("cypress");
const sharp = require("sharp");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function retryRequest(fn, retries = 1, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      const wait = delay * attempt;
      console.log(`    Retry ${attempt}/${retries} after ${wait}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function analyzeImageStyle(imageUrl) {
  try {
    if (
      !imageUrl ||
      imageUrl.endsWith(".svg") ||
      imageUrl.includes("logo") ||
      imageUrl.includes("gravatar") ||
      imageUrl.includes("data:")
    ) {
      return null;
    }

    const response = await retryRequest(() =>
      axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 15000,
      })
    );

    const imageInfo = await sharp(response.data).metadata();
    if (imageInfo.width < 100 || imageInfo.height < 100) {
      return null;
    }

    const image = await sharp(response.data)
      .resize(200, 200, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = image.data;
    const total = image.info.width * image.info.height;

    let grayPixels = 0;
    let coloredPixels = 0;
    let nearBlack = 0;
    let nearWhite = 0;
    let rDom = 0;
    let gDom = 0;
    let bDom = 0;

    for (let i = 0; i < pixels.length; i += 3) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
        grayPixels++;
      } else {
        coloredPixels++;
      }

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC > 15) {
        if (r === maxC) rDom++;
        else if (g === maxC) gDom++;
        else bDom++;
      }

      const lum = (r + g + b) / 3;
      if (lum < 30) nearBlack++;
      if (lum > 225) nearWhite++;
    }

    const grayPct = (grayPixels / total) * 100;
    const colorPct = (coloredPixels / total) * 100;
    const rDomPct = (rDom / total) * 100;
    const gDomPct = (gDom / total) * 100;
    const bDomPct = (bDom / total) * 100;
    const maxColorDom = Math.max(rDomPct, gDomPct, bDomPct);
    const nearBlackPct = (nearBlack / total) * 100;
    const nearWhitePct = (nearWhite / total) * 100;

    const isPureGrayscale = grayPct > 95 && maxColorDom < 1;
    const isMostlyGrayscale = grayPct > 85 && maxColorDom < 4;

    let style = null;

    if (isPureGrayscale) {
      if (nearWhitePct > 40 && nearBlackPct < 5) {
        style = "line-art-sketch";
      } else if (nearBlackPct > 5 || (nearWhitePct > 10 && nearBlackPct > 2)) {
        style = "grayscale-render";
      } else {
        style = "grayscale-render";
      }
    } else if (isMostlyGrayscale) {
      style = "grayscale-render";
    }

    if (!style) {
      return null;
    }

    return {
      isMatch: true,
      style: style,
      grayPercentage: Math.round(grayPct),
      colorRejection: Math.round(colorPct),
      maxColorDominance: Math.round(maxColorDom),
    };
  } catch {
    return null;
  }
}

async function fetchPageImageUrls(pageUrl) {
  const resp = await retryRequest(() =>
    axios.get(pageUrl, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
      },
    })
  );
  const html = resp.data;
  const imageUrls = new Set();

  const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
  let m;
  while ((m = dataOrigSrcRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
  while ((m = imgSrcRegex.exec(html)) !== null) {
    const url = m[1];
    if (
      url.startsWith("http") &&
      !url.endsWith(".svg") &&
      !url.includes("logo") &&
      !url.includes("gravatar") &&
      !url.includes("data:")
    ) {
      imageUrls.add(url);
    }
  }

  const dataBgRegex =
    /data-bg(?:-url)?=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/gi;
  while ((m = dataBgRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  return [...imageUrls].filter(
    (u) =>
      u.startsWith("http") &&
      !u.endsWith(".svg") &&
      !u.includes("data:") &&
      !u.includes("logo") &&
      !u.includes("gravatar") &&
      (u.includes(".jpg") ||
        u.includes(".jpeg") ||
        u.includes(".png") ||
        u.includes(".webp"))
  );
}

async function fetchProjectPageImageUrls(pageUrl) {
  const resp = await retryRequest(() =>
    axios.get(pageUrl, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
      },
    })
  );
  const html = resp.data;
  const imageUrls = new Set();

  let m;

  const srcRegex = /(?:src|data-orig-src|data-lazy-src|data-src)=["']([^"']+)["']/gi;
  while ((m = srcRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  const dataBgRegex = /data-bg(?:-url)?=["']([^"']+)["']/gi;
  while ((m = dataBgRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  const styleRegex = /style=["'][^"']*background-image[^"']*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
  while ((m = styleRegex.exec(html)) !== null) {
    imageUrls.add(m[1]);
  }

  const hrefRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((m = hrefRegex.exec(html)) !== null) {
    const href = m[1];
    if (
      href.includes("/wp-content/uploads/") &&
      /\.(jpg|jpeg|png|webp)/i.test(href)
    ) {
      imageUrls.add(href);
    }
  }

  return [...imageUrls].filter(
    (u) =>
      u.includes("/wp-content/uploads/") &&
      (u.startsWith("http") || u.startsWith("/")) &&
      !u.endsWith(".svg") &&
      !u.includes("data:") &&
      /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)
  );
}

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://pgkltd.co.uk",
    defaultCommandTimeout: 15000,
    responseTimeout: 60000,
    pageLoadTimeout: 120000,

    setupNodeEvents(on, config) {
      on("task", {
        ensureReportDir() {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          return null;
        },

        async fetchAllPortfolioLinks() {
          let pageResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              pageResp = await axios.get(
                "https://pgkltd.co.uk/kitchens/",
                {
                  timeout: 20000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                }
              );
              break;
            } catch (err) {
              console.log(`Attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }
          const html = pageResp.data;

          let nonce = null;
          const scripts = html.split(/<script[^>]*>/i);
          for (const script of scripts) {
            if (script.includes("pgkf_filter")) {
              const match = script.match(
                /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
              );
              if (match) {
                nonce = match[1];
                break;
              }
            }
          }

          if (!nonce) {
            console.log("Nonce not found");
            return [];
          }

          console.log(`Found nonce: ${nonce}`);

          const body = new URLSearchParams();
          body.append("action", "pgkf_filter");
          body.append("nonce", nonce);
          body.append("offset", "0");
          body.append("limit", "200");

          let ajaxResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              ajaxResp = await axios.post(
                "https://pgkltd.co.uk/wp-admin/admin-ajax.php",
                body.toString(),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                  timeout: 20000,
                }
              );
              break;
            } catch (err) {
              console.log(`AJAX attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }

          const data = ajaxResp.data;
          if (!data.success) {
            console.log("AJAX not successful");
            return [];
          }

          console.log(`Total projects: ${data.data.total}`);

          const initialLinks = [
            ...html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const ajaxLinks = [
            ...data.data.html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const allLinks = [
            ...new Set([...initialLinks, ...ajaxLinks]),
          ].filter((href) => href && href.includes("/portfolio/"));

          console.log(`Unique portfolio links: ${allLinks.length}`);
          return allLinks;
        },

        async fetchAllProjectLinks() {
          let pageResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              pageResp = await axios.get(
                "https://pgkltd.co.uk/projects/",
                {
                  timeout: 20000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                }
              );
              break;
            } catch (err) {
              console.log(`Attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }
          const html = pageResp.data;

          let nonce = null;
          const scripts = html.split(/<script[^>]*>/i);
          for (const script of scripts) {
            if (script.includes("pgkf_filter")) {
              const match = script.match(
                /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
              );
              if (match) {
                nonce = match[1];
                break;
              }
            }
          }

          if (!nonce) {
            console.log("Nonce not found on projects page");
            return [];
          }

          console.log(`Found projects nonce: ${nonce}`);

          const body = new URLSearchParams();
          body.append("action", "pgkf_filter");
          body.append("nonce", nonce);
          body.append("offset", "0");
          body.append("limit", "200");

          let ajaxResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              ajaxResp = await axios.post(
                "https://pgkltd.co.uk/wp-admin/admin-ajax.php",
                body.toString(),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                  timeout: 20000,
                }
              );
              break;
            } catch (err) {
              console.log(`AJAX attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }

          const data = ajaxResp.data;
          if (!data.success) {
            console.log("AJAX not successful for projects");
            return [];
          }

          console.log(`Total projects: ${data.data.total}`);

          const initialLinks = [
            ...html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const ajaxLinks = [
            ...data.data.html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const allLinks = [
            ...new Set([...initialLinks, ...ajaxLinks]),
          ].filter((href) => href && href.includes("/portfolio/"));

          console.log(`Unique project portfolio links: ${allLinks.length}`);
          return allLinks;
        },

        async collectKitchensDashboardImages() {
          const links = [];
          let pageResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              pageResp = await axios.get(
                "https://pgkltd.co.uk/kitchens/",
                {
                  timeout: 20000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                }
              );
              break;
            } catch (err) {
              console.log(`Attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }
          const html = pageResp.data;

          let nonce = null;
          const scripts = html.split(/<script[^>]*>/i);
          for (const script of scripts) {
            if (script.includes("pgkf_filter")) {
              const match = script.match(
                /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
              );
              if (match) {
                nonce = match[1];
                break;
              }
            }
          }

          if (!nonce) {
            console.log("Nonce not found");
            return { totalPagesScanned: 0, images: [] };
          }

          console.log(`Found nonce: ${nonce}`);

          const body = new URLSearchParams();
          body.append("action", "pgkf_filter");
          body.append("nonce", nonce);
          body.append("offset", "0");
          body.append("limit", "200");

          let ajaxResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              ajaxResp = await axios.post(
                "https://pgkltd.co.uk/wp-admin/admin-ajax.php",
                body.toString(),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                  timeout: 20000,
                }
              );
              break;
            } catch (err) {
              console.log(`AJAX attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }

          const data = ajaxResp.data;
          if (!data.success) {
            console.log("AJAX not successful");
            return { totalPagesScanned: 0, images: [] };
          }

          const initialLinks = [
            ...html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const ajaxLinks = [
            ...data.data.html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const allLinks = [
            ...new Set([...initialLinks, ...ajaxLinks]),
          ].filter((href) => href && href.includes("/portfolio/"));

          console.log(`Unique portfolio links: ${allLinks.length}`);

          const allImages = [];
          const CONCURRENCY = 2;

          for (let i = 0; i < allLinks.length; i += CONCURRENCY) {
            const batch = allLinks.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (pageUrl) => {
                try {
                  const imageUrls = await fetchPageImageUrls(pageUrl);
                  const filtered = imageUrls.filter((url) =>
                    /\/wp-content\/uploads\/.*PGK-(?:%E2%80%A2|\u2022)-Premium-German-Kitchens-(?:%E2%80%A2|\u2022)-AT.*\.(?:jpg|jpeg|png|webp)/i.test(url)
                  );
                  const slug = pageUrl.split("/portfolio/")[1] || pageUrl;
                  console.log(
                    `  [${i + batch.indexOf(pageUrl) + 1}/${allLinks.length}] ${slug}: ${imageUrls.length} images, ${filtered.length} matched`
                  );
                  return filtered.map((url) => ({ url, page: pageUrl }));
                } catch (err) {
                  console.log(`  SKIP ${pageUrl}: ${err.message}`);
                  return [];
                }
              })
            );

            results.forEach((pageImages) => allImages.push(...pageImages));

            if (i + CONCURRENCY < allLinks.length) {
              await sleep(1500);
            }
          }

          console.log(`\nCollected ${allImages.length} images from ${allLinks.length} pages`);
          return { totalPagesScanned: allLinks.length, images: allImages };
        },

        async scanAllPagesForGrayImages(portfolioLinks) {
          const grayImages = [];
          const CONCURRENCY = 2;
          const BATCH_DELAY = 3000;

          for (let i = 0; i < portfolioLinks.length; i += CONCURRENCY) {
            const batch = portfolioLinks.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (pageUrl) => {
                try {
                  const imageUrls = await fetchPageImageUrls(pageUrl);
                  const pageMatches = [];

                  for (const imgUrl of imageUrls) {
                    const result = await analyzeImageStyle(imgUrl);
                    if (result && result.isMatch) {
                      pageMatches.push({
                        url: imgUrl,
                        page: pageUrl,
                        style: result.style,
                        grayPercentage: result.grayPercentage,
                        colorRejection: result.colorRejection,
                        maxColorDominance: result.maxColorDominance,
                      });
                    }
                  }

                  const idx = i + batch.indexOf(pageUrl) + 1;
                  const slug = pageUrl.split("/portfolio/")[1] || pageUrl;
                  console.log(
                    `  [${idx}/${portfolioLinks.length}] ${slug}: ${imageUrls.length} images, ${pageMatches.length} matched`
                  );

                  return pageMatches;
                } catch (err) {
                  console.log(`  ERROR: ${pageUrl} - ${err.message}`);
                  return [];
                }
              })
            );

            results.forEach((pageMatches) => grayImages.push(...pageMatches));

            if (i + CONCURRENCY < portfolioLinks.length) {
              await sleep(BATCH_DELAY);
            }
          }

          return grayImages;
        },

        async collectProjectDashboardImages() {
          const links = [];
          let pageResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              pageResp = await axios.get(
                "https://pgkltd.co.uk/projects/",
                {
                  timeout: 20000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                }
              );
              break;
            } catch (err) {
              console.log(`Attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }
          const html = pageResp.data;

          let nonce = null;
          const scripts = html.split(/<script[^>]*>/i);
          for (const script of scripts) {
            if (script.includes("pgkf_filter")) {
              const match = script.match(
                /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
              );
              if (match) {
                nonce = match[1];
                break;
              }
            }
          }

          if (!nonce) {
            console.log("Nonce not found on projects page");
            return { totalPagesScanned: 0, images: [] };
          }

          console.log(`Found projects nonce: ${nonce}`);

          const body = new URLSearchParams();
          body.append("action", "pgkf_filter");
          body.append("nonce", nonce);
          body.append("offset", "0");
          body.append("limit", "200");

          let ajaxResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              ajaxResp = await axios.post(
                "https://pgkltd.co.uk/wp-admin/admin-ajax.php",
                body.toString(),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                  timeout: 20000,
                }
              );
              break;
            } catch (err) {
              console.log(`AJAX attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }

          const data = ajaxResp.data;
          if (!data.success) {
            console.log("AJAX not successful for projects");
            return { totalPagesScanned: 0, images: [] };
          }

          console.log(`Total projects: ${data.data.total}`);

          const initialLinks = [
            ...html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const ajaxLinks = [
            ...data.data.html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const allLinks = [
            ...new Set([...initialLinks, ...ajaxLinks]),
          ].filter((href) => href && href.includes("/portfolio/"));

          console.log(`Unique project portfolio links: ${allLinks.length}`);

          const allImages = [];
          const CONCURRENCY = 2;

          for (let i = 0; i < allLinks.length; i += CONCURRENCY) {
            const batch = allLinks.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (pageUrl) => {
                try {
                  const imageUrls = await fetchProjectPageImageUrls(pageUrl);
                  const slug = pageUrl.split("/portfolio/")[1] || pageUrl;
                  console.log(
                    `  [${i + batch.indexOf(pageUrl) + 1}/${allLinks.length}] ${slug}: ${imageUrls.length} images`
                  );
                  return imageUrls.map((url) => ({ url, page: pageUrl }));
                } catch (err) {
                  console.log(`  SKIP ${pageUrl}: ${err.message}`);
                  return [];
                }
              })
            );

            results.forEach((pageImages) => allImages.push(...pageImages));

            if (i + CONCURRENCY < allLinks.length) {
              await sleep(1500);
            }
          }

          console.log(`\nCollected ${allImages.length} images from ${allLinks.length} pages`);
          return { totalPagesScanned: allLinks.length, images: allImages };
        },

        saveKitchensDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "kitchens-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  KITCHENS DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          data.images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url} (from: ${img.page})`);
          });

          return null;
        },

        saveProjectDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "project-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  PROJECT DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          data.images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url} (from: ${img.page})`);
          });

          return null;
        },

        async collectInspirationDashboardImages() {
          const links = [];
          let pageResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              pageResp = await axios.get(
                "https://pgkltd.co.uk/inspirations/",
                {
                  timeout: 20000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                }
              );
              break;
            } catch (err) {
              console.log(`Attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }
          const html = pageResp.data;

          let nonce = null;
          const scripts = html.split(/<script[^>]*>/i);
          for (const script of scripts) {
            if (script.includes("pgkf_filter")) {
              const match = script.match(
                /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
              );
              if (match) {
                nonce = match[1];
                break;
              }
            }
          }

          if (!nonce) {
            console.log("Nonce not found on inspirations page");
            return { totalPagesScanned: 0, images: [] };
          }

          console.log(`Found inspirations nonce: ${nonce}`);

          const body = new URLSearchParams();
          body.append("action", "pgkf_filter");
          body.append("nonce", nonce);
          body.append("offset", "0");
          body.append("limit", "200");

          let ajaxResp;
          for (let attempt = 1; attempt <= 1; attempt++) {
            try {
              ajaxResp = await axios.post(
                "https://pgkltd.co.uk/wp-admin/admin-ajax.php",
                body.toString(),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                  },
                  timeout: 20000,
                }
              );
              break;
            } catch (err) {
              console.log(`AJAX attempt ${attempt} failed: ${err.message}`);
              if (attempt === 1) throw err;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
          }

          const data = ajaxResp.data;
          if (!data.success) {
            console.log("AJAX not successful for inspirations");
            return { totalPagesScanned: 0, images: [] };
          }

          console.log(`Total inspirations projects: ${data.data.total}`);

          const initialLinks = [
            ...html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const ajaxLinks = [
            ...data.data.html.matchAll(
              /<a[^>]*class="pgkf-link"[^>]*href="([^"]+)"/g
            ),
          ].map((m) => m[1]);

          const allLinks = [
            ...new Set([...initialLinks, ...ajaxLinks]),
          ].filter((href) => href && href.includes("/portfolio/"));

          console.log(`Unique inspiration portfolio links: ${allLinks.length}`);

          const allImages = [];
          const CONCURRENCY = 2;

          for (let i = 0; i < allLinks.length; i += CONCURRENCY) {
            const batch = allLinks.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (pageUrl) => {
                try {
                  const imageUrls = await fetchProjectPageImageUrls(pageUrl);
                  const slug = pageUrl.split("/portfolio/")[1] || pageUrl;
                  console.log(
                    `  [${i + batch.indexOf(pageUrl) + 1}/${allLinks.length}] ${slug}: ${imageUrls.length} images`
                  );
                  return imageUrls.map((url) => ({ url, page: pageUrl }));
                } catch (err) {
                  console.log(`  SKIP ${pageUrl}: ${err.message}`);
                  return [];
                }
              })
            );

            results.forEach((pageImages) => allImages.push(...pageImages));

            if (i + CONCURRENCY < allLinks.length) {
              await sleep(1500);
            }
          }

          console.log(`\nCollected ${allImages.length} images from ${allLinks.length} pages`);
          return { totalPagesScanned: allLinks.length, images: allImages };
        },

        saveInspirationDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "inspiration-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  INSPIRATION DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          data.images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url} (from: ${img.page})`);
          });

          return null;
        },

        async collectShowroomsDashboardImages() {
          const imageUrls = new Set();
          const pageUrl = "https://pgkltd.co.uk/showrooms/";

          let pageResp;
          try {
            pageResp = await axios.get(pageUrl, {
              timeout: 20000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
              },
            });
          } catch (err) {
            console.log(`Failed to fetch showrooms page: ${err.message}`);
            return { totalPagesScanned: 1, images: [] };
          }

          const html = pageResp.data;

          let m;

          const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
          while ((m = dataOrigSrcRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const dataBgRegex = /data-bg=["']([^"']+)["']/g;
          while ((m = dataBgRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
          while ((m = imgSrcRegex.exec(html)) !== null) {
            const url = m[1];
            if (url.startsWith("http") && !url.startsWith("data:")) {
              imageUrls.add(url);
            }
          }

          const dataSrcsetRegex = /data-srcset=["']([^"']+)["']/g;
          while ((m = dataSrcsetRegex.exec(html)) !== null) {
            const srcsetEntries = m[1].split(",");
            for (const entry of srcsetEntries) {
              const url = entry.trim().split(/\s+/)[0];
              if (url && url.startsWith("http")) {
                imageUrls.add(url);
              }
            }
          }

          const filtered = [...imageUrls].filter(
            (u) =>
              u.startsWith("http") &&
              !u.endsWith(".svg") &&
              !u.includes("data:") &&
              !u.includes("gravatar") &&
              /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)
          );

          const allImages = filtered.map((url) => ({ url, page: pageUrl }));

          console.log(`\nCollected ${allImages.length} images from showrooms page`);
          return { totalPagesScanned: 1, images: allImages };
        },

        saveShowroomsDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "showrooms-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  SHOWROOMS DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          data.images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url} (from: ${img.page})`);
          });

          return null;
        },

        async collectShowroomDashboardImages(showroomUrls) {
          const allImages = [];
          let totalPagesScanned = 0;

          for (const url of showroomUrls) {
            totalPagesScanned++;
            const imageUrls = new Set();

            let pageResp;
            try {
              pageResp = await axios.get(url, {
                timeout: 20000,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                },
              });
            } catch (err) {
              console.log(`Failed to fetch ${url}: ${err.message}`);
              continue;
            }

            const html = pageResp.data;
            let m;

            const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
            while ((m = dataOrigSrcRegex.exec(html)) !== null) {
              imageUrls.add(m[1]);
            }

            const dataBgRegex = /data-bg=["']([^"']+)["']/g;
            while ((m = dataBgRegex.exec(html)) !== null) {
              imageUrls.add(m[1]);
            }

            const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
            while ((m = imgSrcRegex.exec(html)) !== null) {
              const imgUrl = m[1];
              if (imgUrl.startsWith("http") && !imgUrl.startsWith("data:")) {
                imageUrls.add(imgUrl);
              }
            }

            const dataSrcsetRegex = /data-srcset=["']([^"']+)["']/g;
            while ((m = dataSrcsetRegex.exec(html)) !== null) {
              const srcsetEntries = m[1].split(",");
              for (const entry of srcsetEntries) {
                const imgUrl = entry.trim().split(/\s+/)[0];
                if (imgUrl && imgUrl.startsWith("http")) {
                  imageUrls.add(imgUrl);
                }
              }
            }

            const backgroundUrlRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/g;
            while ((m = backgroundUrlRegex.exec(html)) !== null) {
              const imgUrl = m[1];
              if (imgUrl.startsWith("http") && !imgUrl.startsWith("data:")) {
                imageUrls.add(imgUrl);
              }
            }

            const filtered = [...imageUrls].filter(
              (u) =>
                u.startsWith("http") &&
                !u.endsWith(".svg") &&
                !u.includes("data:") &&
                !u.includes("gravatar") &&
                /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)
            );

            const showroomName = url.replace("https://pgkltd.co.uk/showrooms/", "").replace(/\/$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

            filtered.forEach((imgUrl) => {
              allImages.push({ url: imgUrl, page: url, showroom: showroomName });
            });

            console.log(`  ${showroomName}: ${filtered.length} images found`);
          }

          return { totalPagesScanned, images: allImages };
        },

        saveShowroomDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "showroom-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            showrooms: data.showrooms || [],
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  SHOWROOM DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          const grouped = {};
          data.images.forEach((img) => {
            if (!grouped[img.showroom]) grouped[img.showroom] = [];
            grouped[img.showroom].push(img.url);
          });

          Object.entries(grouped).forEach(([showroom, urls]) => {
            console.log(`  ${showroom} (${urls.length} images):`);
            urls.forEach((url, i) => {
              console.log(`    ${i + 1}. ${url}`);
            });
            console.log("");
          });

          return null;
        },

        async collectShowroomSectionImages(input) {
          const BASE = "https://pgkltd.co.uk";
          const showroomUrls = input.showroomUrls || [];
          const nestedCardUrls = input.nestedCardUrls || [];
          const allImages = [];
          let totalPagesScanned = 0;

          function extractImages(html, pageUrl) {
            const imageUrls = new Set();
            let m;

            const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
            while ((m = dataOrigSrcRegex.exec(html)) !== null) {
              imageUrls.add(m[1]);
            }

            const dataBgRegex = /data-bg=["']([^"']+)["']/g;
            while ((m = dataBgRegex.exec(html)) !== null) {
              imageUrls.add(m[1]);
            }

            const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
            while ((m = imgSrcRegex.exec(html)) !== null) {
              const url = m[1];
              if (url.startsWith("http") && !url.startsWith("data:")) {
                imageUrls.add(url);
              }
            }

            const dataSrcsetRegex = /data-srcset=["']([^"']+)["']/g;
            while ((m = dataSrcsetRegex.exec(html)) !== null) {
              const entries = m[1].split(",");
              for (const entry of entries) {
                const url = entry.trim().split(/\s+/)[0];
                if (url && url.startsWith("http")) {
                  imageUrls.add(url);
                }
              }
            }

            const bgUrlRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/g;
            while ((m = bgUrlRegex.exec(html)) !== null) {
              const url = m[1];
              if (url.startsWith("http") && !url.startsWith("data:")) {
                imageUrls.add(url);
              }
            }

            return [...imageUrls].filter(
              (u) =>
                u.startsWith("http") &&
                !u.endsWith(".svg") &&
                !u.includes("data:") &&
                !u.includes("gravatar") &&
                /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)
            );
          }

          async function fetchPage(url) {
            const resp = await axios.get(url, {
              timeout: 20000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
              },
            });
            return resp.data;
          }

          const showrooms = [];

          for (const url of showroomUrls) {
            const slug = url.replace(`${BASE}/showrooms/`, "").replace(/\/$/, "");
            const showroomName = slug
              .replace(/-/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());

            console.log(`--- ${showroomName} ---`);
            console.log(`  Fetching: ${url}`);
            totalPagesScanned++;

            let showroomHtml;
            try {
              showroomHtml = await fetchPage(url);
            } catch (err) {
              console.log(`  Failed: ${err.message}`);
              continue;
            }

            const showroomImages = extractImages(showroomHtml, url);
            showroomImages.forEach((imgUrl) => {
              allImages.push({
                url: imgUrl,
                page: url,
                showroom: showroomName,
                source: "showroom-page",
              });
            });
            console.log(`  Showroom page: ${showroomImages.length} images`);

            const showroomNestedCards = nestedCardUrls.filter(
              (c) => c.showroom === showroomName
            );

            if (showroomNestedCards.length > 0) {
              console.log(
                `  Found ${showroomNestedCards.length} nested portfolio cards`
              );

              for (const card of showroomNestedCards) {
                totalPagesScanned++;
                const cardName = card.url
                  .replace(`${BASE}/portfolio/`, "")
                  .replace(/\/$/, "")
                  .replace(/-/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase());

                console.log(`  Fetching card: ${cardName}`);
                try {
                  const cardHtml = await fetchPage(card.url);
                  const cardImages = extractImages(cardHtml, card.url);
                  cardImages.forEach((imgUrl) => {
                    allImages.push({
                      url: imgUrl,
                      page: card.url,
                      showroom: showroomName,
                      source: `nested-card/${cardName}`,
                    });
                  });
                  console.log(`    ${cardImages.length} images found`);
                } catch (err) {
                  console.log(`    Failed: ${err.message}`);
                }
              }
            } else {
              console.log(`  No nested portfolio cards found`);
            }

            showrooms.push({
              name: showroomName,
              url: url,
              imagesOnShowroomPage: showroomImages.length,
              nestedCards: showroomNestedCards.length,
              nestedCardUrls: showroomNestedCards.map((c) => c.url),
            });

            console.log("");
          }

          return {
            totalPagesScanned,
            images: allImages,
            showrooms,
          };
        },

        saveShowroomSectionReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(
            dir,
            data.filename || "showroom-section-images-report.json"
          );
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            showrooms: data.showrooms || [],
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  SHOWROOM SECTION IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          if (data.showrooms) {
            data.showrooms.forEach((sr) => {
              console.log(`  ${sr.name}:`);
              console.log(`    Showroom page images: ${sr.imagesOnShowroomPage}`);
              console.log(`    Nested cards: ${sr.nestedCards}`);
              if (sr.nestedCardUrls && sr.nestedCardUrls.length > 0) {
                sr.nestedCardUrls.forEach((url, i) => {
                  console.log(`      ${i + 1}. ${url}`);
                });
              }
              console.log("");
            });
          }

          const grouped = {};
          data.images.forEach((img) => {
            const key = `${img.showroom} (${img.source})`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(img.url);
          });

          Object.entries(grouped).forEach(([group, urls]) => {
            console.log(`  ${group} - ${urls.length} images:`);
            urls.forEach((url, i) => {
              console.log(`    ${i + 1}. ${url}`);
            });
            console.log("");
          });

          return null;
        },
        async collectWhyPGKDashboardImages() {
          const imageUrls = new Set();
          const pageUrl = "https://pgkltd.co.uk/pgk-approach/";

          let pageResp;
          try {
            pageResp = await axios.get(pageUrl, {
              timeout: 20000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
              },
            });
          } catch (err) {
            console.log(`Failed to fetch Why PGK page: ${err.message}`);
            return { totalPagesScanned: 1, images: [] };
          }

          const html = pageResp.data;
          let m;

          const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
          while ((m = dataOrigSrcRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
          while ((m = imgSrcRegex.exec(html)) !== null) {
            const url = m[1];
            if (url.startsWith("http") && !url.startsWith("data:")) {
              imageUrls.add(url);
            }
          }

          const dataBgRegex = /data-bg=["']([^"']+)["']/g;
          while ((m = dataBgRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const dataSrcsetRegex = /data-srcset=["']([^"']+)["']/g;
          while ((m = dataSrcsetRegex.exec(html)) !== null) {
            const srcsetEntries = m[1].split(",");
            for (const entry of srcsetEntries) {
              const url = entry.trim().split(/\s+/)[0];
              if (url && url.startsWith("http")) {
                imageUrls.add(url);
              }
            }
          }

          const srcsetRegex = /srcset=["']([^"']+)["']/g;
          while ((m = srcsetRegex.exec(html)) !== null) {
            const srcsetEntries = m[1].split(",");
            for (const entry of srcsetEntries) {
              const url = entry.trim().split(/\s+/)[0];
              if (url && url.startsWith("http")) {
                imageUrls.add(url);
              }
            }
          }

          const backgroundUrlRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/g;
          while ((m = backgroundUrlRegex.exec(html)) !== null) {
            const url = m[1];
            if (url.startsWith("http") && !url.startsWith("data:")) {
              imageUrls.add(url);
            }
          }

          const ogImageRegex = /<meta[^>]*content=["']([^"']+\.(jpg|jpeg|png|webp))["'][^>]*>/gi;
          while ((m = ogImageRegex.exec(html)) !== null) {
            if (m[1].startsWith("http")) imageUrls.add(m[1]);
          }

          const wpUploadRegex = /["'](https?:\/\/[^"']*wp-content\/uploads\/[^"']+\.(jpg|jpeg|png|webp|gif|svg))[^"']*["']/gi;
          while ((m = wpUploadRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const filtered = [...imageUrls].filter(
            (u) =>
              u.startsWith("http") &&
              !u.includes("data:") &&
              !u.includes("gravatar") &&
              !u.includes("analytics.") &&
              !u.includes("googletagmanager") &&
              !u.includes("google.com/recaptcha") &&
              !u.endsWith(".js") &&
              /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(u)
          );

          const allImages = filtered.map((url) => ({ url, page: pageUrl }));

          console.log(`\nCollected ${allImages.length} images from Why PGK page`);
          allImages.forEach((img, i) => console.log(`  ${i + 1}. ${img.url}`));
          return { totalPagesScanned: 1, images: allImages };
        },

        saveWhyPGKDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "why-pgk-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  WHY PGK DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          data.images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url} (from: ${img.page})`);
          });

          return null;
        },

        async collectFinanceDashboardImages() {
          const imageUrls = new Set();
          const pageUrl = "https://pgkltd.co.uk/finance/";

          let pageResp;
          try {
            pageResp = await axios.get(pageUrl, {
              timeout: 20000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
              },
            });
          } catch (err) {
            console.log(`Failed to fetch Finance page: ${err.message}`);
            return { totalPagesScanned: 1, images: [] };
          }

          const html = pageResp.data;
          let m;

          const dataOrigSrcRegex = /data-orig-src=["']([^"']+)["']/g;
          while ((m = dataOrigSrcRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const imgSrcRegex = /<img[^>]*src=["']([^"']+)["']/g;
          while ((m = imgSrcRegex.exec(html)) !== null) {
            const url = m[1];
            if (url.startsWith("http") && !url.startsWith("data:")) {
              imageUrls.add(url);
            }
          }

          const dataBgRegex = /data-bg=["']([^"']+)["']/g;
          while ((m = dataBgRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const dataSrcsetRegex = /data-srcset=["']([^"']+)["']/g;
          while ((m = dataSrcsetRegex.exec(html)) !== null) {
            const srcsetEntries = m[1].split(",");
            for (const entry of srcsetEntries) {
              const url = entry.trim().split(/\s+/)[0];
              if (url && url.startsWith("http")) {
                imageUrls.add(url);
              }
            }
          }

          const srcsetRegex = /srcset=["']([^"']+)["']/g;
          while ((m = srcsetRegex.exec(html)) !== null) {
            const srcsetEntries = m[1].split(",");
            for (const entry of srcsetEntries) {
              const url = entry.trim().split(/\s+/)[0];
              if (url && url.startsWith("http")) {
                imageUrls.add(url);
              }
            }
          }

          const backgroundUrlRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/g;
          while ((m = backgroundUrlRegex.exec(html)) !== null) {
            const url = m[1];
            if (url.startsWith("http") && !url.startsWith("data:")) {
              imageUrls.add(url);
            }
          }

          const ogImageRegex = /<meta[^>]*content=["']([^"']+\.(jpg|jpeg|png|webp))["'][^>]*>/gi;
          while ((m = ogImageRegex.exec(html)) !== null) {
            if (m[1].startsWith("http")) imageUrls.add(m[1]);
          }

          const wpUploadRegex = /["'](https?:\/\/[^"']*wp-content\/uploads\/[^"']+\.(jpg|jpeg|png|webp|gif|svg))[^"']*["']/gi;
          while ((m = wpUploadRegex.exec(html)) !== null) {
            imageUrls.add(m[1]);
          }

          const filtered = [...imageUrls].filter(
            (u) =>
              u.startsWith("http") &&
              !u.includes("data:") &&
              !u.includes("gravatar") &&
              !u.includes("analytics.") &&
              !u.includes("googletagmanager") &&
              !u.includes("google.com/recaptcha") &&
              !u.endsWith(".js") &&
              /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(u)
          );

          const allImages = filtered.map((url) => ({ url, page: pageUrl }));

          console.log(`\nCollected ${allImages.length} images from Finance page`);
          allImages.forEach((img, i) => console.log(`  ${i + 1}. ${img.url}`));
          return { totalPagesScanned: 1, images: allImages };
        },

        saveFinanceDashboardReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "finance-dashboard-images-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const output = {
            totalImages: data.images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: data.images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  FINANCE DASHBOARD IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Images  : ${data.images.length}`);
          console.log(`  Unique URLs   : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned : ${data.totalPagesScanned}`);
          console.log(`  Saved to      : ${file}`);
          console.log(`========================================\n`);

          data.images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url} (from: ${img.page})`);
          });

          return null;
        },
           

        saveReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, data.filename || "gray-image-report.json");
          const uniqueUrls = [...new Set(data.images.map((i) => i.url))];

          const images = data.images.map((img) => ({
            url: img.url,
            page: img.page,
            percentage: 100,
          }));

          const output = {
            totalGrayImages: images.length,
            uniqueImageUrls: uniqueUrls.length,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            images: images,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  GRAYSCALE IMAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Gray Images : ${images.length}`);
          console.log(`  Unique URLs       : ${uniqueUrls.length}`);
          console.log(`  Pages Scanned     : ${data.totalPagesScanned}`);
          console.log(`  Saved to          : ${file}`);
          console.log(`========================================\n`);

          images.forEach((img, i) => {
            console.log(`  ${i + 1}. ${img.url}`);
          });

          return null;
        },

        async getAllPageUrls() {
          const BASE = "https://pgkltd.co.uk";

          async function fetchHtml(url) {
            const resp = await retryRequest(() =>
              axios.get(url, {
                timeout: 20000,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                },
              })
            );
            return typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
          }

          async function discoverPagesFromSitemap() {
            const pageUrls = new Set();
            const subSitemaps = [];

            try {
              const xml = await fetchHtml(`${BASE}/sitemap.xml`);
              const subSitemapRegex = /<sitemap>\s*<loc>([^<]+)<\/loc>/gi;
              let m;
              while ((m = subSitemapRegex.exec(xml)) !== null) {
                const subLoc = m[1].trim();
                if (subLoc.endsWith(".xml") && subLoc.startsWith(BASE)) {
                  subSitemaps.push(subLoc);
                }
              }
            } catch (err) {
              console.log(`  Main sitemap failed: ${err.message}`);
            }

            for (const subUrl of subSitemaps) {
              try {
                const xml = await fetchHtml(subUrl);
                const locRegex = /<loc>([^<]+)<\/loc>/gi;
                let m;
                while ((m = locRegex.exec(xml)) !== null) {
                  const loc = m[1].trim();
                  if (
                    loc.startsWith(BASE) &&
                    !loc.includes("/wp-content/") &&
                    !loc.includes("/wp-json/") &&
                    !loc.includes(".xml") &&
                    !loc.includes("/feed/")
                  ) {
                    pageUrls.add(loc);
                  }
                }
              } catch (err) {
                console.log(`  Sub-sitemap ${subUrl} failed: ${err.message}`);
              }
            }

            return [...pageUrls];
          }

          async function discoverPagesFromHomepage() {
            const pageUrls = new Set();
            try {
              const html = await fetchHtml(BASE);
              const linkRegex = /href=["'](https?:\/\/pgkltd\.co\.uk\/[^"']*)/gi;
              let m;
              while ((m = linkRegex.exec(html)) !== null) {
                let url = m[1].split("#")[0].split("?")[0].replace(/\/$/, "");
                if (
                  url.startsWith(BASE) &&
                  !url.includes("/wp-content/") &&
                  !url.includes("/wp-json/") &&
                  !url.includes("/feed/") &&
                  !url.includes("/wp-admin/") &&
                  !url.includes("/xmlrpc") &&
                  !url.includes("/comments") &&
                  url !== BASE
                ) {
                  pageUrls.add(url);
                }
              }
            } catch (err) {
              console.log(`  Homepage fetch failed: ${err.message}`);
            }
            return [...pageUrls];
          }

          async function fetchDashboardLinks(dashboardUrl, label) {
            const pageUrls = new Set();
            try {
              const html = await fetchHtml(dashboardUrl);

              let nonce = null;
              const scripts = html.split(/<script[^>]*>/i);
              for (const script of scripts) {
                if (script.includes("pgkf_filter")) {
                  const match = script.match(
                    /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
                  );
                  if (match) {
                    nonce = match[1];
                    break;
                  }
                }
              }

              if (nonce) {
                const body = new URLSearchParams();
                body.append("action", "pgkf_filter");
                body.append("nonce", nonce);
                body.append("offset", "0");
                body.append("limit", "200");

                const ajaxResp = await axios.post(
                  `${BASE}/wp-admin/admin-ajax.php`,
                  body.toString(),
                  {
                    headers: {
                      "Content-Type": "application/x-www-form-urlencoded",
                      "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                    },
                    timeout: 20000,
                  }
                );

                if (ajaxResp.data.success) {
                  const links = [
                    ...ajaxResp.data.data.html.matchAll(
                      /href="([^"]+)"/g
                    ),
                  ]
                    .map((m) => m[1])
                    .filter(
                      (href) =>
                        href.startsWith("http") &&
                        !href.includes("/wp-content/") &&
                        !href.includes("/wp-json/")
                    );

                  links.forEach((href) => pageUrls.add(href.replace(/\/$/, "")));
                }
              }
            } catch (err) {
              console.log(`  ${label} failed: ${err.message}`);
            }
            return [...pageUrls];
          }

          console.log("\n=== Discovering pages ===");

          const [sitemapPages, homepageLinks, kitchensLinks, projectsLinks, inspirationsLinks] =
            await Promise.all([
              discoverPagesFromSitemap(),
              discoverPagesFromHomepage(),
              fetchDashboardLinks(`${BASE}/kitchens/`, "Kitchens"),
              fetchDashboardLinks(`${BASE}/projects/`, "Projects"),
              fetchDashboardLinks(`${BASE}/inspirations/`, "Inspirations"),
            ]);

          const allPageUrls = [
            ...new Set([
              BASE,
              ...sitemapPages,
              ...homepageLinks,
              ...kitchensLinks,
              ...projectsLinks,
              ...inspirationsLinks,
            ]),
          ];

          console.log(`  Total unique pages discovered: ${allPageUrls.length}`);
          return allPageUrls;
        },

        async findPagesContainingImages(targetImageUrls) {
          const BASE = "https://pgkltd.co.uk";
          const CONCURRENCY = 5;
          const BATCH_DELAY = 1000;
          const matches = [];

          function buildSearchStrings(imgUrl) {
            const strings = [imgUrl];
            const path = imgUrl.replace(BASE, "");
            if (path !== imgUrl) strings.push(path);

            const lastTwoParts = imgUrl.split("/").slice(-2).join("/");
            strings.push(lastTwoParts);

            const filename = imgUrl.split("/").pop();
            strings.push(filename);

            if (imgUrl.includes("wp-content/uploads")) {
              const cdnUrl = imgUrl
                .replace(`${BASE}/wp-content/uploads/`, "https://media.pgkltd.co.uk/")
                .replace(/\/\d+\//, "/");
              strings.push(cdnUrl);
              strings.push(cdnUrl.split("/").slice(-2).join("/"));
              strings.push(cdnUrl.split("/").pop());
            }

            return [...new Set(strings)];
          }

          async function fetchHtml(url) {
            const resp = await retryRequest(() =>
              axios.get(url, {
                timeout: 20000,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                },
              })
            );
            return typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
          }

          async function discoverPagesFromSitemap() {
            const pageUrls = new Set();
            const subSitemaps = [];
            try {
              const xml = await fetchHtml(`${BASE}/sitemap.xml`);
              const subSitemapRegex = /<sitemap>\s*<loc>([^<]+)<\/loc>/gi;
              let m;
              while ((m = subSitemapRegex.exec(xml)) !== null) {
                const subLoc = m[1].trim();
                if (subLoc.endsWith(".xml") && subLoc.startsWith(BASE)) {
                  subSitemaps.push(subLoc);
                }
              }
            } catch (err) {
              console.log(`  Sitemap failed: ${err.message}`);
            }
            for (const subUrl of subSitemaps) {
              try {
                const xml = await fetchHtml(subUrl);
                const locRegex = /<loc>([^<]+)<\/loc>/gi;
                let m;
                while ((m = locRegex.exec(xml)) !== null) {
                  const loc = m[1].trim();
                  if (
                    loc.startsWith(BASE) &&
                    !loc.includes("/wp-content/") &&
                    !loc.includes("/wp-json/") &&
                    !loc.includes(".xml") &&
                    !loc.includes("/feed/")
                  ) {
                    pageUrls.add(loc);
                  }
                }
              } catch (err) {}
            }
            return [...pageUrls];
          }

          async function discoverPagesFromHomepage() {
            const pageUrls = new Set();
            try {
              const html = await fetchHtml(BASE);
              const linkRegex = /href=["'](https?:\/\/pgkltd\.co\.uk\/[^"']*)/gi;
              let m;
              while ((m = linkRegex.exec(html)) !== null) {
                let url = m[1].split("#")[0].split("?")[0].replace(/\/$/, "");
                if (
                  url.startsWith(BASE) &&
                  !url.includes("/wp-content/") &&
                  !url.includes("/wp-json/") &&
                  !url.includes("/feed/") &&
                  !url.includes("/wp-admin/") &&
                  url !== BASE
                ) {
                  pageUrls.add(url);
                }
              }
            } catch (err) {}
            return [...pageUrls];
          }

          async function fetchDashboardLinks(dashboardUrl) {
            const pageUrls = new Set();
            try {
              const html = await fetchHtml(dashboardUrl);
              let nonce = null;
              const scripts = html.split(/<script[^>]*>/i);
              for (const script of scripts) {
                if (script.includes("pgkf_filter")) {
                  const match = script.match(
                    /var\s+NONCE\s*=\s*["']([a-f0-9]+)["']/
                  );
                  if (match) { nonce = match[1]; break; }
                }
              }
              if (nonce) {
                const body = new URLSearchParams();
                body.append("action", "pgkf_filter");
                body.append("nonce", nonce);
                body.append("offset", "0");
                body.append("limit", "200");
                const ajaxResp = await axios.post(
                  `${BASE}/wp-admin/admin-ajax.php`,
                  body.toString(),
                  {
                    headers: {
                      "Content-Type": "application/x-www-form-urlencoded",
                      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0",
                    },
                    timeout: 20000,
                  }
                );
                if (ajaxResp.data.success) {
                  [...ajaxResp.data.data.html.matchAll(/href="([^"]+)"/g)]
                    .map((m) => m[1])
                    .filter((h) => h.startsWith("http") && !h.includes("/wp-content/"))
                    .forEach((h) => pageUrls.add(h.replace(/\/$/, "")));
                }
              }
            } catch (err) {}
            return [...pageUrls];
          }

          const searchStringsPerImage = targetImageUrls.map((u) => ({
            originalUrl: u,
            searchStrings: buildSearchStrings(u),
          }));

          console.log("\n=== Discovering pages ===");
          const [sitemapPages, homepageLinks, kitchensLinks, projectsLinks, inspirationsLinks] =
            await Promise.all([
              discoverPagesFromSitemap(),
              discoverPagesFromHomepage(),
              fetchDashboardLinks(`${BASE}/kitchens/`),
              fetchDashboardLinks(`${BASE}/projects/`),
              fetchDashboardLinks(`${BASE}/inspirations/`),
            ]);

          const allPageUrls = [
            ...new Set([BASE, ...sitemapPages, ...homepageLinks, ...kitchensLinks, ...projectsLinks, ...inspirationsLinks]),
          ];

          console.log(`  Total pages: ${allPageUrls.length}`);
          console.log(`  Target images: ${targetImageUrls.length}`);
          console.log("\n=== Scanning pages ===\n");

          for (let i = 0; i < allPageUrls.length; i += CONCURRENCY) {
            const batch = allPageUrls.slice(i, i + CONCURRENCY);
            await Promise.all(
              batch.map(async (pageUrl) => {
                try {
                  const html = await fetchHtml(pageUrl);
                  for (const { originalUrl, searchStrings } of searchStringsPerImage) {
                    for (const s of searchStrings) {
                      if (html.includes(s)) {
                        matches.push({
                          imageUrl: originalUrl,
                          pageUrl: pageUrl,
                          matchedString: s,
                        });
                        break;
                      }
                    }
                  }
                  const idx = i + batch.indexOf(pageUrl) + 1;
                  const slug = pageUrl.replace(BASE, "") || "/";
                  const found = matches.some((m) => m.pageUrl === pageUrl);
                  console.log(`  [${idx}/${allPageUrls.length}] ${slug} ${found ? ">>> MATCH <<<" : ""}`);
                } catch (err) {
                  const idx = i + batch.indexOf(pageUrl) + 1;
                  console.log(`  [${idx}/${allPageUrls.length}] ERROR: ${pageUrl.replace(BASE, "")} - ${err.message}`);
                }
              })
            );
            if (i + CONCURRENCY < allPageUrls.length) await sleep(BATCH_DELAY);
          }

          console.log(`\n=== Scan complete ===`);
          console.log(`Pages scanned: ${allPageUrls.length}`);
          console.log(`Total matches: ${matches.length}`);

          return {
            totalMatches: matches.length,
            totalPagesScanned: allPageUrls.length,
            collectedAt: new Date().toISOString(),
            matches,
          };
        },

        saveImagePageReport(data) {
          const dir = path.join("cypress", "reports");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const file = path.join(dir, "image-page-report.json");

          const output = {
            totalMatches: data.totalMatches,
            totalPagesScanned: data.totalPagesScanned,
            collectedAt: data.collectedAt,
            matches: data.matches,
          };

          fs.writeFileSync(file, JSON.stringify(output, null, 2));

          console.log(`\n========================================`);
          console.log(`  IMAGE-PAGE REPORT`);
          console.log(`========================================`);
          console.log(`  Total Matches    : ${data.totalMatches}`);
          console.log(`  Pages Scanned    : ${data.totalPagesScanned}`);
          console.log(`  Saved to         : ${file}`);
          console.log(`========================================\n`);

          if (data.matches.length > 0) {
            data.matches.forEach((match, i) => {
              console.log(`  ${i + 1}. Image: ${match.imageUrl}`);
              console.log(`     Found on: ${match.pageUrl}`);
            });
          } else {
            console.log("  No matches found for the target image URLs.");
          }

          return null;
        },
      });

      return config;
    },
  },
});