// เขียน fixtures/station-tickets-golden.json จาก planTickets + layoutTicket — รันจาก commit ก่อนเพิ่ม printRouting เท่านั้น
// node build แล้ว: node out/stationTicketsGolden.gen.mjs > fixtures/station-tickets-golden.json
import { layoutTicket, planTickets } from "../../src/app/staff/stationTickets";
import { ROUTING_CATEGORIES, ROUTING_ORDERS, ROUTING_ROLES } from "./printRoutingFixtures.mjs";
const out = {};
for (const order of ROUTING_ORDERS) for (const role of ROUTING_ROLES)
  out[`${order.id}/${role}`] = planTickets(order, role, ROUTING_CATEGORIES).map((plan) => ({
    station: plan.station,
    lines: layoutTicket(order, plan, "th"),
  }));
process.stdout.write(JSON.stringify(out) + "\n");
