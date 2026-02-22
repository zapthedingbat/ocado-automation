export class BasePage {
  constructor(page) {
    this.page = page;
    this.cookieAcceptButton = page.locator('[data-test-id="cookie-consent-accept"]');
  }

  async acceptCookies() {
    await this.cookieAcceptButton.click({ timeout: 2000 });
  }

  async removeCookieOverlays() {
    await this.page.evaluate(() => {
      document.querySelector('#onetrust-consent-sdk')?.remove();
      document.querySelector('.onetrust-pc-dark-filter')?.remove();
    });
  }
}
