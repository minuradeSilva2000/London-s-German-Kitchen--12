Cypress.on("uncaught:exception", () => false);

describe("Find Page Containing Image URL", () => {

  const targetImages = [
    "https://pgkltd.co.uk/wp-content/uploads/2026/05/04170049/IMG_9538.webp",
    "https://pgkltd.co.uk/wp-content/uploads/2026/05/04170052/IMG_9536.JPG.webp"
  ];

  before(() => {
    cy.task("ensureReportDir");
  });

  it("Find pages containing the given image URLs", () => {

    cy.task("findPagesContainingImages", targetImages, {
      timeout: 1800000
    }).then((result) => {

      cy.task("saveImagePageReport", result);

      cy.log(`Pages scanned: ${result.totalPagesScanned}`);
      cy.log(`Matches found: ${result.totalMatches}`);

      if (result.matches.length > 0) {
        result.matches.forEach((match) => {
          cy.log(`  Image: ${match.imageUrl}`);
          cy.log(`  Found on: ${match.pageUrl}`);
        });
      } else {
        cy.log("No pages found containing the target image URLs.");
      }

      expect(result.totalPagesScanned).to.be.greaterThan(0);

    });

  });

});
