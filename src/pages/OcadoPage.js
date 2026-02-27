import { BasePage } from './BasePage.js';
import { createLogger } from '../logger.js';

const log = createLogger('ocado page');

export class OcadoPage extends BasePage {
  constructor(page) {
    super(page);
    this._initialState = null;
  }

  async getInitialState() {
    if (this._initialState) return this._initialState;
    log('Waiting for __INITIAL_STATE__ in page');
    const state = await this.page.waitForFunction(() => {
        const state = window.__INITIAL_STATE__;
        if (!state) return null;
        return state;
    }, { timeout: 15000 }).then(h => h.jsonValue());
    this._initialState = state;
    return this._initialState;
  }

  async getCsrfToken() {
    return (await this.getInitialState()).session.csrf.token;
  }
}
