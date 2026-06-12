import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CSV_FILE = join(__dirname, '../../data/Operator-Taryfa-Godzinytaniezakres-Godzinydrogieza.csv');

export interface TariffPresetItem {
    operator: string;
    tariff: string;
    cheapRanges: string;
    expensiveRanges: string;
    cheapPrice: string;
    expensivePrice: string;
    parsedCheap?: { start: string; end: string; type: 'offpeak' | 'peak' }[];
    parsedExpensive?: { start: string; end: string; type: 'offpeak' | 'peak' }[];
}

function parseComplexRange(rangeStr: string, type: 'offpeak' | 'peak'): { start: string; end: string; type: 'offpeak' | 'peak' }[] {
    const result: { start: string; end: string; type: 'offpeak' | 'peak' }[] = [];

    if (rangeStr.includes('brak')) return [];

    // Check if it's ONLY full day (no + separator)
    const onlyFullDay = rangeStr.includes('cała doba') || rangeStr.includes('00:00–24:00') || rangeStr.includes('00:00-24:00');
    const hasMultipleRanges = rangeStr.includes(' + ') || rangeStr.includes('+');

    if (onlyFullDay && !hasMultipleRanges) {
        result.push({ start: '00:00', end: '23:59', type });
        return result;
    }

    // Handle "Lato:" and "Zima:" sections - take the first complete set
    let workRanges = rangeStr;
    const latoIdx = workRanges.toLowerCase().indexOf('lato:');
    const zimaIdx = workRanges.toLowerCase().indexOf('zima:');

    if (latoIdx >= 0 || zimaIdx >= 0) {
        // Take Lato section if present, otherwise Zima
        const startIdx = latoIdx >= 0 ? latoIdx + 5 : zimaIdx + 5;
        const endIdx = latoIdx >= 0 && zimaIdx >= 0 ? zimaIdx : workRanges.length;
        workRanges = workRanges.substring(startIdx, endIdx).trim();
    }

    // Split by + (range separators)
    const parts = workRanges.split(/\s*\+\s*/);
    for (const part of parts) {
        let cleaned = part.trim();

        // Remove day indicators
        cleaned = cleaned.replace(/Pn–Pt|SB–ND|weekend|cała doba|Lato:|Zima:|\d{4}-\d{2}-\d{2}/gi, '').trim();
        // Normalize dash character
        cleaned = cleaned.replace(/–/g, '-');

        if (!cleaned) continue;

        // Find time range pattern HH:MM-HH:MM
        const match = cleaned.match(/(\d{1,2}:\d{2})\s*[-]\s*(\d{1,2}:\d{2})/);
        if (match) {
            const startH = match[1].split(':')[0].padStart(2, '0');
            const startM = (match[1].split(':')[1] || '00').padStart(2, '0');
            let endH = match[2].split(':')[0].padStart(2, '0');
            const endM = (match[2].split(':')[1] || '00').padStart(2, '0');

            const start = `${startH}:${startM}`;
            let end = `${endH}:${endM}`;

            // Handle "00:00-24:00" as full day (converted to 23:59)
            if (start === '00:00' && endH === '24') {
                end = '23:59';
            }
            // Handle "00:00-00:00" (from 24:00 conversion) - skip if same as start
            if (start === end) {
                continue;
            }

            result.push({ start, end, type });
        }
    }

    return result;
}

export function loadTariffPresets(): TariffPresetItem[] {
    if (!existsSync(CSV_FILE)) {
        console.warn('[TariffParser] CSV file not found:', CSV_FILE);
        return [];
    }

    try {
        const content = readFileSync(CSV_FILE, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

        const presets: TariffPresetItem[] = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].match(/(".*?"|[^,]+)/g) || [];
            const row = cols.map(c => c.replace(/"/g, '').trim());

            const operator = row[0] || '';
            const tariff = row[1] || '';
            const cheapRanges = row[2] || '';
            const expensiveRanges = row[3] || '';
            const cheapPrice = row[4] || '';
            const expensivePrice = row[5] || '';

            const item: TariffPresetItem = {
                operator,
                tariff,
                cheapRanges,
                expensiveRanges,
                cheapPrice,
                expensivePrice,
                parsedCheap: parseComplexRange(cheapRanges, 'offpeak'),
                parsedExpensive: parseComplexRange(expensiveRanges, 'peak'),
            };

            presets.push(item);
        }

        console.log(`[TariffParser] Loaded ${presets.length} tariff presets`);
        return presets;
    } catch (e) {
        console.error('[TariffParser] Error loading CSV:', e);
        return [];
    }
}

export function getTariffForSelect(): { name: string; provider: string; peakRanges: any[]; offpeakRanges: any[]; peakPrice: number; offpeakPrice: number }[] {
    const presets = loadTariffPresets();
    return presets.map(p => {
        const provider = `${p.operator} ${p.tariff}`;
        const peakPrice = parseFloat(p.expensivePrice.match(/[\d,]+/)?.[0]?.replace(',', '.') || '0');
        const offpeakPrice = parseFloat(p.cheapPrice.match(/[\d,]+/)?.[0]?.replace(',', '.') || '0');

        return {
            name: provider,
            provider,
            peakRanges: p.parsedExpensive || [],
            offpeakRanges: p.parsedCheap || [],
            peakPrice,
            offpeakPrice,
        };
    });
}