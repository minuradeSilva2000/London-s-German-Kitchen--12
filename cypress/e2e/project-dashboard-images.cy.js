Cypress.on("uncaught:exception", () => false);

describe("PGK Project Dashboard - Image URL Collector", () => {
  before(() => {
    cy.task("ensureReportDir");
  });

  it("Collect all image URLs from project dashboard pages", () => {
    cy.intercept("**/*.{css,js,woff,woff2,ttf,otf,eot}", {
      statusCode: 200,
      body: "",
      headers: { "Content-Type": "text/plain" },
    });

    cy.intercept("**/*.{jpg,jpeg,png,gif,webp,svg,ico}", {
      statusCode: 200,
      body: "",
      headers: { "Content-Type": "image/png" },
    });

    cy.task("fetchAllProjectLinks", null, { timeout: 120000 }).then(
      (portfolioLinks) => {
        expect(portfolioLinks).to.have.length.greaterThan(0);
        cy.log(`Scanning ${portfolioLinks.length} project dashboard pages`);

        const allDashboardImages = [];

        cy.wrap(portfolioLinks)
          .each((link) => {
            cy.visit(link, {
              timeout: 120000,
              failOnStatusCode: false,
            });

            cy.document().then((doc) => {
              doc.querySelectorAll("img").forEach((el) => {
                const urls = [
                  el.getAttribute("src"),
                  el.getAttribute("data-orig-src"),
                  el.getAttribute("data-lazy-src"),
                  el.getAttribute("data-src"),
                ];
                urls.forEach((url) => {
                  if (url && url.includes("/wp-content/uploads/")) {
                    allDashboardImages.push({ url, page: link });
                  }
                });
              });

              doc.querySelectorAll("[data-bg]").forEach((el) => {
                const url = el.getAttribute("data-bg");
                if (url && url.includes("/wp-content/uploads/")) {
                  allDashboardImages.push({ url, page: link });
                }
              });

              doc.querySelectorAll("[data-bg-url]").forEach((el) => {
                const url = el.getAttribute("data-bg-url");
                if (url && url.includes("/wp-content/uploads/")) {
                  allDashboardImages.push({ url, page: link });
                }
              });

              doc.querySelectorAll("[style]").forEach((el) => {
                const style = el.getAttribute("style") || "";
                if (style.includes("background-image")) {
                  const match = style.match(
                    /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i
                  );
                  if (match && match[1].includes("/wp-content/uploads/")) {
                    allDashboardImages.push({ url: match[1], page: link });
                  }
                }
              });

              doc.querySelectorAll("a[href]").forEach((el) => {
                const href = el.getAttribute("href");
                if (
                  href &&
                  href.includes("/wp-content/uploads/") &&
                  /\.(jpg|jpeg|png|webp)/i.test(href)
                ) {
                  allDashboardImages.push({ url: href, page: link });
                }
              });
            });
          })
          .then(() => {
            const uniqueUrls = [
              ...new Set(allDashboardImages.map((img) => img.url)),
            ];

            cy.task("saveProjectDashboardReport", {
              totalImages: allDashboardImages.length,
              uniqueImageUrls: uniqueUrls.length,
              totalPagesScanned: portfolioLinks.length,
              collectedAt: new Date().toISOString(),
              images: allDashboardImages,
              filename: "project-dashboard-images-report.json",
            });
          });
      }
    );
  });
});
