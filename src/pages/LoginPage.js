import { BasePage } from './BasePage.js';

export class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.signInButton = page.locator('button:has-text("Sign in")');
    this.continueButton = page.locator('button:has-text("Continue")');
  }

  async goto() {
    await this.page.goto('https://accounts.ocado.com/auth-service/sso/login', { waitUntil: 'domcontentloaded' });
  }

  async login(email, password) {
    await this.acceptCookies();
    await this.emailInput.waitFor({ timeout: 10000 });
    await this.emailInput.fill(email);
    await this.continueButton.click({ timeout: 5000 });
    await this.page.waitForLoadState('domcontentloaded');
    await this.passwordInput.waitFor({ timeout: 10000 });
    await this.passwordInput.fill(password);
    await this.acceptCookies();
    await this.removeCookieOverlays();
    await this.signInButton.click({ timeout: 10000 });
    await this.page.waitForURL('**/groceries**', { timeout: 30000 });
  }
}
