import { AutomationNode } from '../types';
import { automationState } from '../state';

/**
 * Obliczeniowy węzeł typu "calc".
 *
 * Konfiguracja (`node.config`):
 *   - expr: string   // wyrażenie JavaScript
 *
 * Dostępne zmienne w wyrażeniu:
 *   - predictor – najnowszy węzeł typu predictor (lub null)
 *   - battery   – { soc: number, capacityKwh: number } z węzła inverter (lub null)
 *   - settings   – pełna sekcja settings z automationState
 *
 * Wynik (liczba) zapisywany jest w `node.data.value`.
 */
export async function runCalcNode(node: AutomationNode): Promise<void> {
  const cfg = node.config || {};
  const expr = cfg.expr as string;
  if (!expr) {
    node.lastVal = 'NO‑EXPR';
    return;
  }

  const predictor = Object.values(automationState.nodes)
    .find(n => n.type === 'predictor')?.data ?? null;

  const inverter = Object.values(automationState.nodes)
    .find(n => n.type === 'inverter')?.data ?? null;

  const context = {
    predictor,
    battery:
      inverter?.battery_soc != null
        ? {
            soc: inverter?.battery_soc,
            capacityKwh: Number(automationState.settings.solar?.batteryKwh ?? 0),
          }
        : null,
    settings: automationState.settings,
    Math,
    Number,
  };

  let value: any;
  try {
    const fn = new Function(...Object.keys(context), `return (${expr});`);
    value = fn(...Object.values(context));
  } catch (e) {
    node.lastVal = `ERR ${(e as Error).message}`;
    return;
  }

  node.data = { ...(node.data || {}), value };
  node.lastVal = `OK ${value}`;
}
