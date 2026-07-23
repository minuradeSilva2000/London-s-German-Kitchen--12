Cypress.on("uncaught:exception", () => false);

describe("Finance Dashboard - Image URL Collector", () => {
  before(() => {
    cy.task("ensureReportDir");
  });

  it("Collect all image URLs from Finance Options dashboard page", () => {
    cy.task("collectFinanceDashboardImages", null, { timeout: 1800000 }).then(
      (result) => {
        expect(result.images.length).to.be.greaterThan(0);
        cy.log(`Collected ${result.images.length} images from ${result.totalPagesScanned} pages`);

        cy.task("saveFinanceDashboardReport", {
          totalImages: result.images.length,
          uniqueImageUrls: [...new Set(result.images.map((i) => i.url))].length,
          totalPagesScanned: result.totalPagesScanned,
          collectedAt: new Date().toISOString(),
          images: result.images,
          filename: "finance-dashboard-images-report.json",
        });
      }
    );
  });
});
