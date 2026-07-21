Cypress.on("uncaught:exception", () => false);

describe("PGK Kitchens Dashboard - Image URL Collector", () => {
  before(() => {
    cy.task("ensureReportDir");
  });

  it("Collect image URLs containing /wp-content/uploads/ with PGK-•-Premium-German-Kitchens-•-AT.jpg path from kitchens dashboard pages", () => {
    cy.task("collectKitchensDashboardImages", null, { timeout: 900000 }).then(
      (result) => {
        expect(result.images.length).to.be.greaterThan(0);
        cy.log(`Collected ${result.images.length} matching images from ${result.totalPagesScanned} pages`);

        cy.task("saveKitchensDashboardReport", {
          totalImages: result.images.length,
          uniqueImageUrls: [...new Set(result.images.map((i) => i.url))].length,
          totalPagesScanned: result.totalPagesScanned,
          collectedAt: new Date().toISOString(),
          images: result.images,
          filename: "kitchens-dashboard-images-report.json",
        });
      }
    );
  });
});
