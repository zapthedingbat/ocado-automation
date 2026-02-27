import { BasePage } from './BasePage.js';
import { createLogger } from '../logger.js';

const log = createLogger('login');

export class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.emailInput = page.locator('[data-synthetics="username-input"]');
    this.passwordInput = page.locator('[data-synthetics="password-input"]');
    this.logInButton = page.locator('[data-synthetics="login-submit-button"]');
    this.onetrustAcceptButton = page.locator('#onetrust-accept-btn-handler');
    this.onetrustConsentSdk = page.locator('#onetrust-consent-sdk');
    this.recaptchaIframe = page.locator('iframe[src*="recaptcha"], iframe[title*="recaptcha challenge"]');
  }

  async goto() {
    log('Navigating to login page');
    await this.page.goto('https://www.ocado.com/login?destination=%2F', { waitUntil: 'domcontentloaded' });
    log('Login page loaded');
  }

  async login(email, password) {
    log('Starting login (accepting cookies, filling form)');
    await this.acceptCookies();
    log('Filling email and password');
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    log('Clicking log in button');
    await this.logInButton.click({ timeout: 10000 });
    log('Waiting for reCAPTCHA if present');
    await this.waitForRecaptchaIfNeeded();
    log('Waiting for redirect to www.ocado.com');
    await this.page.waitForURL('https://www.ocado.com/', { timeout: 30000 });
    log('Redirect complete, login successful');
  }

  async isRecaptchaVisible() {
    const count = await this.recaptchaIframe.count();
    if (count === 0) return false;
    return this.recaptchaIframe.first().isVisible();
  }

  async waitForRecaptchaIfNeeded({ timeout = 180000, pollInterval = 1000 } = {}) {
    const deadline = Date.now() + timeout;
    while (await this.isRecaptchaVisible()) {
      if (Date.now() > deadline) throw new Error('reCAPTCHA was not solved within the timeout period');
      await new Promise(r => setTimeout(r, pollInterval));
    }
  }

  async acceptCookies() {
    await this.onetrustConsentSdk.waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
    if (await this.onetrustAcceptButton.isVisible()) {
      log('Accepting cookie banner');
      await this.onetrustAcceptButton.click({ timeout: 2000 });
    }
  }
}
