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
      });

      return config;
    },
  },
});
