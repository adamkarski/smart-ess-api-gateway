export type NodeType = 'weather' | 'inverter' | 'tuya';

export interface AutomationNode {
    id: string;
    type: NodeType;
    name: string;
    config: any;
    lastUpdate: number;
    data: any;
}

export interface AutomationRule {
    id: string;
    name: string;
    enabled: boolean;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
}

export interface AutomationCondition {
    nodeId: string;
    parameter: string;
    operator: 'eq' | 'gt' | 'lt' | 'true' | 'false';
    value: any;
}

export interface AutomationAction {
    nodeId: string;
    action: string;
    params: any;
}

export interface AutomationState {
    nodes: Record<string, AutomationNode>;
    rules: AutomationRule[];
    settings: {
        weather: {
            apiKey: string;
            lat: string;
            lon: string;
            city?: string;
        };
        tuya: {
            apiKey: string;
            apiSecret: string;
            region: string;
        };
    };
}
