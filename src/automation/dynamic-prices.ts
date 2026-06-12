import { automationState } from './state';
import { DynamicPrice } from './types';

const PRICE_FETCH_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours

export async function fetchDynamicPrices(): Promise<DynamicPrice[]> {
    const tariff = (automationState.settings as any).tariff;
    if (!tariff || tariff.source !== 'dynamic') return [];

    const now = Date.now();
    const lastFetch = tariff.lastPriceFetch || 0;
    if (now - lastFetch < PRICE_FETCH_INTERVAL && tariff.dynamicPrices?.length) {
        console.log('[DynamicPrices] Using cached prices');
        return tariff.dynamicPrices;
    }

    try {
        const prices = await fetchRBEPrices();
        tariff.dynamicPrices = prices;
        tariff.lastPriceFetch = now;
        console.log(`[DynamicPrices] Fetched ${prices.length} hourly prices`);
        return prices;
    } catch (err) {
        console.error('[DynamicPrices] Fetch error:', err.message);
        return tariff.dynamicPrices || [];
    }
}

async function fetchRBEPrices(): Promise<DynamicPrice[]> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const url = `https://www.pse.pl/api-ws/cei/price-history?date=${dateStr}&type=DAY_AHEAD`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        return parsePSEPrices(data);
    } catch (err) {
        console.warn('[DynamicPrices] PSE API failed, trying mock:', err.message);
        return generateMockPrices();
    }
}

function parsePSEPrices(data: any): DynamicPrice[] {
    const tariff = (automationState.settings as any).tariff;
    const threshold = tariff.dynamicThreshold || 300;
    const prices: DynamicPrice[] = [];
    const today = new Date().toISOString().split('T')[0];

    if (Array.isArray(data)) {
        for (const item of data) {
            const hour = parseInt(item.hour || item.h) - 1;
            const pricePlnMwh = parseFloat(item.price || item.cena || item.value);

            if (!isNaN(hour) && !isNaN(pricePlnMwh)) {
                const isCheap = pricePlnMwh < threshold;
                prices.push({ date: today, hour, pricePerMwh: pricePlnMwh, isCheap });
            }
        }
    }
    return prices;
}

function generateMockPrices(): DynamicPrice[] {
    const tariff = (automationState.settings as any).tariff;
    const threshold = tariff.dynamicThreshold || 300;
    const prices: DynamicPrice[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (let hour = 0; hour < 24; hour++) {
        let basePrice = 200 + Math.sin((hour - 6) * Math.PI / 12) * 150;
        basePrice += (Math.random() - 0.5) * 50;
        const price = Math.round(basePrice * 100) / 100;
        const isCheap = price < threshold;
        prices.push({ date: today, hour, pricePerMwh: price, isCheap });
    }
    return prices;
}

export function isDynamicCheapNow(): boolean {
    const tariff = (automationState.settings as any).tariff;
    if (tariff?.source !== 'dynamic' || !tariff.dynamicPrices?.length) return false;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentHour = now.getHours();

    const price = tariff.dynamicPrices.find((p: any) => p.date === todayStr && p.hour === currentHour);
    return price?.isCheap || false;
}

export function getCurrentPricePerKwh(): number {
    const tariff = (automationState.settings as any).tariff;
    if (!tariff) return 0.6;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentHour = now.getHours();

    if (tariff.source === 'dynamic' && tariff.dynamicPrices?.length) {
        const price = tariff.dynamicPrices.find(p => p.date === todayStr && p.hour === currentHour);
        if (price) return price.pricePerMwh / 1000;
    }

    return tariff.offpeakPricePerKwh || 0.55;
}
