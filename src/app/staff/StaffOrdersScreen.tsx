import { useState } from "react";
import { Check, Clock, Plus, Printer, Trash2, X } from "lucide-react";
import type { CartItem, Language, Order, StaffTab } from "../types";
import { T } from "../translations";
import { compareTables, formatClock, liveItems, orderTotal, timeAgo } from "../utils";
import { StaffHeader } from "./StaffHeader";
import { KitchenTicket } from "./ticket";

// ─── Staff Orders Screen ──────────────────────────────────────────────────────

interface StaffOrdersProps {
  lang: Language;
  orders: Order[];
  onMarkServed: (orderId: string) => void;
  onRemoveItem: (orderId: string, cartId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onStartManualOrder: () => void;
}

export function StaffOrdersScreen({ lang, orders, onMarkServed, onRemoveItem, onCancelOrder, onTabChange, onLogout, onLangToggle, onAskConfirm, onStartManualOrder }: StaffOrdersProps) {
  const t = T[lang];
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const handlePrintKitchen = (order: Order) => {
    setPrintOrder(order);
    // รอให้ React render เนื้อหาก่อนค่อยสั่งพิมพ์
    setTimeout(() => window.print(), 50);
  };
  const takeawayOrders = orders.filter((o) => o.isTakeaway && o.status === "in-progress");
  const inProgress = orders.filter((o) => o.status === "in-progress" && !o.isTakeaway);
  const awaitingPayment = orders.filter((o) => o.status === "awaiting-payment" && !o.isTakeaway);

  // Group awaiting orders by table
  const awaitingByTable: Record<string, { orders: Order[]; total: number }> = {};
  awaitingPayment.forEach((o) => {
    if (!awaitingByTable[o.tableNumber]) {
      awaitingByTable[o.tableNumber] = { orders: [], total: 0 };
    }
    awaitingByTable[o.tableNumber].orders.push(o);
    awaitingByTable[o.tableNumber].total += orderTotal(o);
  });
  const awaitingTables = Object.entries(awaitingByTable)
    .sort(([a], [b]) => compareTables(a, b));

  function optionSummary(ci: CartItem): string {
    const parts: string[] = [];
    if (ci.meat) parts.push(T[lang].meats[ci.meat]);
    if (ci.portion === "special") parts.push(t.special);
    if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
    if (ci.addEgg) parts.push(t.eggAdded);
    ci.item.customGroups?.forEach((group) => {
      const selected = ci.customSelections?.[group.id] || [];
      group.choices.forEach((choice) => {
        if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
      });
    });
    return parts.join(", ");
  }

  return (
    <>
      <div className="min-h-screen bg-background flex flex-col">
        <StaffHeader
          lang={lang}
          activeTab="orders"
          onTabChange={onTabChange}
          onLogout={onLogout}
          onLangToggle={onLangToggle}
        />

        <div
          className="flex-1 px-4 py-5 overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >

          <button
            onClick={onStartManualOrder}
            className="w-full mb-5 bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {lang === "en" ? "Create Order for Table" : "สร้างออเดอร์ให้โต๊ะ"}
          </button>

          {/* ปุ่มทดสอบพิมพ์จริงผ่าน Bluetooth (BLE) — พักไว้ก่อน ยังจับคู่ช้าอยู่ ค่อยกลับมาแก้ต่อ
          <button
            onClick={() => {
              const testOrder = [...takeawayOrders, ...inProgress][0];
              if (!testOrder) { alert("ยังไม่มีออเดอร์ให้ทดสอบพิมพ์ ลองสร้างออเดอร์ก่อน"); return; }
              printKitchenTicketBLE(testOrder, lang);
            }}
            className="w-full mb-5 bg-muted text-foreground py-2.5 rounded-xl font-semibold text-xs hover:bg-muted/80 transition-all active:scale-95"
          >
            🖨️ ทดสอบพิมพ์จริง (BLE)
          </button>
          */}

          {/* Takeaway orders */}
          {takeawayOrders.length > 0 && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-accent" />
                <h2 className="font-semibold text-foreground">{lang === "en" ? "Takeaway" : "กลับบ้าน"}</h2>
                <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                  {takeawayOrders.length}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {takeawayOrders.map((order) => (
                  <div key={order.id} className="bg-card rounded-2xl border-2 overflow-hidden" style={{ borderColor: "rgba(208, 126, 53, 0.4)" }}>
                    <div className="px-4 py-3 flex items-center justify-between border-b" style={{ background: "rgba(208, 126, 53, 0.08)", borderColor: "rgba(208, 126, 53, 0.15)" }}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-accent text-accent-foreground font-display font-bold text-sm rounded-full flex items-center justify-center flex-shrink-0">
                          {order.takeawayLabel}
                        </div>
                        <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                      </div>
                      <button
                        onClick={() => onCancelOrder(order.id)}
                        className="text-destructive/60 hover:text-destructive transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      {order.items.map((ci) => (
                        <div key={ci.cartId} className={`flex items-start gap-2.5 ${ci.voided ? "opacity-50" : ""}`}>
                          <div className={`font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${ci.voided ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                            {ci.quantity}
                          </div>
                          <div className={`text-sm font-medium leading-tight ${ci.voided ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {lang === "en" ? ci.item.name.en : ci.item.name.th}
                            {ci.voided && (
                              <span className="text-destructive not-italic no-underline ml-1">
                                ({t.voidedLabel}{ci.voidReason ? `: ${ci.voidReason}` : ""})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => onMarkServed(order.id)}
                        className="w-full bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Check size={15} />
                        {lang === "en" ? "Ready for pickup" : "พร้อมรับแล้ว"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* In Progress */}
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <h2 className="font-semibold text-foreground">{t.inProgress}</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                {inProgress.length}
              </span>
            </div>

            {inProgress.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
                {t.noActiveOrders}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {inProgress.map((order) => (
                  <div
                    key={order.id}
                    className="bg-card rounded-2xl border-2 overflow-hidden"
                    style={{ borderColor: "rgba(217, 119, 6, 0.3)" }}
                  >
                    {/* Order header */}
                    <div
                      className="px-4 py-3 flex items-center justify-between border-b"
                      style={{ background: "rgba(251, 191, 36, 0.08)", borderColor: "rgba(217, 119, 6, 0.15)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#3C2414] text-[#FFF8F0] font-display font-bold text-lg rounded-full flex items-center justify-center flex-shrink-0">
                          {order.tableNumber}
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t.tableLabel}</div>
                          <div className="font-semibold text-foreground text-sm">{timeAgo(order.timestamp)}</div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <Clock size={12} />
                          <span>{formatClock(order.timestamp)}</span>
                        </div>
                        <button
                          onClick={() => onCancelOrder(order.id)}
                          className="text-destructive/60 hover:text-destructive transition-colors"
                          title={t.cancelOrder}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Items */}
                    <div className="px-4 py-3 space-y-2.5">
                      {order.items.map((ci) => (
                        <div key={ci.cartId} className={`flex items-start gap-2.5 ${ci.voided ? "opacity-50" : ""}`}>
                          <div className={`font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${ci.voided ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                            {ci.quantity}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium leading-tight ${ci.voided ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {lang === "en" ? ci.item.name.en : ci.item.name.th}
                            </div>
                            {optionSummary(ci) && (
                              <div className="text-muted-foreground text-xs mt-0.5">{optionSummary(ci)}</div>
                            )}
                            {ci.note && (
                              <div className="text-amber-700 text-xs mt-0.5 italic">"{ci.note}"</div>
                            )}
                            {ci.customNote && (
                              <div className="text-primary text-xs mt-0.5 font-medium">
                                + {ci.customNote} (+{t.thb}{ci.customAddOnPrice || 0})
                              </div>
                            )}
                            {ci.voided && (
                              <div className="text-destructive text-xs mt-0.5">
                                {t.voidedLabel}{ci.voidReason ? ` · ${ci.voidReason}` : ""}
                              </div>
                            )}
                          </div>
                          {!ci.voided && (
                            <button
                              onClick={() => onRemoveItem(order.id, ci.cartId)}
                              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 mt-0.5"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Action */}
                    <div className="px-4 pb-4 flex gap-2">
                      <button
                        onClick={() => handlePrintKitchen(order)}
                        className="flex-shrink-0 bg-muted text-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-muted/80 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Printer size={15} />
                      </button>
                      <button
                        onClick={() => onMarkServed(order.id)}
                        className="flex-1 bg-secondary text-secondary-foreground py-2.5 rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <Check size={15} />
                        {t.markServed}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Awaiting Payment */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
              <h2 className="font-semibold text-foreground">{t.awaitingPayment}</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
                {awaitingTables.length}
              </span>
            </div>

            {awaitingTables.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-2xl border border-border">
                {t.noTablesWaiting}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {awaitingTables.map(([tableNum, data]) => (
                  <div
                    key={tableNum}
                    className="bg-card rounded-2xl border-2 overflow-hidden opacity-80"
                    style={{ borderColor: "rgba(74, 103, 65, 0.3)" }}
                  >
                    <div
                      className="px-4 py-3 flex items-center justify-between border-b"
                      style={{ background: "rgba(74, 103, 65, 0.06)", borderColor: "rgba(74, 103, 65, 0.15)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary text-secondary-foreground font-display font-bold text-lg rounded-full flex items-center justify-center flex-shrink-0">
                          {tableNum}
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t.tableLabel}</div>
                          <div className="text-muted-foreground text-sm">
                            {data.orders.length} {data.orders.length === 1 ? t.rounds : t.roundsPlural}
                          </div>
                        </div>
                      </div>
                      <div className="font-display font-bold text-xl text-foreground">
                        {t.thb}{data.total}
                      </div>
                    </div>
                    <div className="px-4 py-2.5">
                      <div className="text-xs text-muted-foreground">
                        {data.orders.reduce((s, o) => s + liveItems(o.items).length, 0)} {t.items} · {t.awaitingPayment}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {printOrder && <KitchenTicket order={printOrder} lang={lang} />}
    </>
  );
}
