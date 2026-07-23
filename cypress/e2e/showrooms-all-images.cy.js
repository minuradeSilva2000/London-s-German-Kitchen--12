Cypress.on("uncaught:exception", () => false);

describe("PGK Showrooms Section - Full Image Collector", () => {
  const showroomUrls = [
    "https://pgkltd.co.uk/showrooms/amersham/",
    "https://pgkltd.co.uk/showrooms/bounds-green/",
    "https://pgkltd.co.uk/showrooms/maida-vale/",
    "https://pgkltd.co.uk/showrooms/wimbledon/",
  ];

  let allNestedCardUrls = [];

  before(() => {
    cy.task("ensureReportDir");
  });

  it("Open site, click Showrooms menu, navigate each card and nested cards", () => {
    cy.visit("/", { timeout: 30000 });

    cy.contains("a", "Showrooms").first().click({ force: true });
    cy.url().should("include", "/showrooms/");

    cy.get("a[href*='/showrooms/']")
      .filter((i, el) => {
        const href = el.getAttribute("href") || "";
        return (
          href.match(/\/showrooms\/[a-z-]+\/$/) &&
          !href.endsWith("/showrooms/")
        );
      })
      .then(($links) => {
        cy.log(`Found ${$links.length} showroom card links on dashboard`);
      });

    showroomUrls.forEach((url) => {
      const slug = url
        .replace("https://pgkltd.co.uk/showrooms/", "")
        .replace(/\/$/, "");
      const showroomName = slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      cy.log(`Clicking showroom card: ${showroomName}`);
      cy.visit(url, { timeout: 30000 });
      cy.url().should("include", slug);
      cy.log(`Loaded ${showroomName} showroom page`);

      cy.get("body", { timeout: 10000 }).then(($body) => {
        const pgkfGrid = $body.find(".pgkf .pgkf-grid");
        if (pgkfGrid.length > 0) {
          cy.get(".pgkf .pgkf-card a.pgkf-link", { timeout: 15000 }).then(
            ($cards) => {
              if ($cards.length > 0) {
                cy.log(
                  `Found ${$cards.length} nested portfolio cards in ${showroomName}`
                );
                $cards.each((i, el) => {
                  const href = el.getAttribute("href");
                  if (href) {
                    const cardUrl = href.startsWith("http")
                      ? href
                      : `https://pgkltd.co.uk${href}`;
                    allNestedCardUrls.push({
                      url: cardUrl,
                      showroom: showroomName,
                    });
                    cy.log(`  Card found: ${cardUrl}`);
                  }
                });
              } else {
                cy.log(`No nested portfolio cards in ${showroomName}`);
              }
            }
          );
        } else {
          cy.log(`No pgkf grid in ${showroomName}`);
        }
      });
    });

    cy.then(() => {
      cy.log(
        `Total nested cards collected across all showrooms: ${allNestedCardUrls.length}`
      );
      cy.task(
        "collectShowroomSectionImages",
        { showroomUrls, nestedCardUrls: allNestedCardUrls },
        { timeout: 120000 }
      ).then((result) => {
        expect(result.images.length).to.be.greaterThan(0);
        cy.log(`Total images collected: ${result.images.length}`);

        cy.task("saveShowroomSectionReport", {
          totalImages: result.images.length,
          uniqueImageUrls: [...new Set(result.images.map((i) => i.url))]
            .length,
          totalPagesScanned: result.totalPagesScanned,
          collectedAt: new Date().toISOString(),
          showrooms: result.showrooms,
          images: result.images,
          filename: "showroom-section-images-report.json",
        });
      });
    });
  });
});