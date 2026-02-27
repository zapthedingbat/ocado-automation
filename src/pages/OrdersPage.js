import { OcadoPage } from './OcadoPage.js';

export class OrdersPage extends OcadoPage {
  constructor(page) {
    super(page);
  }

  async goto() {
    await this.page.goto('https://www.ocado.com/orders', { waitUntil: 'domcontentloaded' });
  }

  async getUpcomingOrders() {
    const initialState = await this.getInitialState();
    const orderEntities = initialState?.data?.orders?.orderEntities ?? initialState?.orders?.orderEntities;
    const orders = Object.values(orderEntities ?? {}).filter(e => e?.orderId).map(o => ({
        orderId: o.orderId,
        status: o.status,
        slot: o.dates ? { start: o.dates.deliveryStartDate, end: o.dates.deliveryEndDate } : null,
        address: o.address,
        totalPrice: o.orderTotals.totalPrice.amount,
        totalItems: o.orderTotals.totalItems,
        editStatus: o.editStatus,
    }));
    return { orders };
  }
}
