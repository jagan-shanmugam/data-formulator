// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configureStore, EnhancedStore } from '@reduxjs/toolkit';
import { 
    dataFormulatorReducer, 
    DataFormulatorState, 
    dfActions, 
    fetchAutoDashboard, 
    generateFreshChart, 
    ModelConfig, 
    initialState as dfInitialState,
    // Assuming createDictTableFromRows and getDataFieldItems are exported or accessible for testing
    // If not, their logic might need to be replicated or mocked here.
} from './dfSlice'; 
import { DictTable, FieldItem, Chart, Type as DfType } from '../components/ComponentType'; 
// import { getUrls } from './utils'; // getUrls is not directly used in these tests, but fetchAutoDashboard uses it internally.

// Mock fetch globally for thunk tests
global.fetch = jest.fn();

const mockFetch = global.fetch as jest.Mock;

// Minimal helper to create DictTable, assuming not exported from dfSlice or too complex to import
// This helps in creating a valid DictTable structure for tests.
const testCreateDictTableFromRows = (id: string, rows: any[], displayId?: string): DictTable => {
    if (rows.length === 0) {
        return { id, names: [], types: [], rows: [], anchored: false, displayId: displayId || id };
    }
    const names = Object.keys(rows[0]);
    const types = names.map(name => {
        const sampleValue = rows[0][name];
        if (typeof sampleValue === 'number') return DfType.Number;
        if (typeof sampleValue === 'boolean') return DfType.Boolean;
        // Basic date check, can be more robust
        if (typeof sampleValue === 'string' && !isNaN(Date.parse(sampleValue))) return DfType.Date; 
        return DfType.String;
    });
    return { id, names, types, rows, anchored: false, displayId: displayId || id };
};

const testGetDataFieldItems = (baseTable: DictTable): FieldItem[] => {
    return baseTable.names.map((name, index) => {
        const id = `original--${baseTable.id}--${name}`; // Standard ID format
        const type = baseTable.types[index];
        // Basic domain calculation for testing purposes
        const columnValues = baseTable.rows.map((r: any) => r[name]);
        const domain = Array.from(new Set(columnValues));
        return { id, name, type, source: "original", tableRef: baseTable.id, description: "", domain };
    }) || [];
};


// Helper to create a minimal store for testing
const createTestStore = (preloadedState?: Partial<DataFormulatorState>): EnhancedStore<{dataFormulator: DataFormulatorState}> => {
    return configureStore({
        reducer: {
            dataFormulator: dataFormulatorReducer,
        },
        // Ensure essential parts of initialState are present, then override with preloadedState
        preloadedState: { dataFormulator: { ...dfInitialState, ...preloadedState } },
    });
};

describe('dfSlice - fetchAutoDashboard Thunk', () => {
    let store: EnhancedStore<{dataFormulator: DataFormulatorState}>;
    const mockTableName = 'test_table_for_dashboard';
    const mockModel: ModelConfig = { id: 'test-model-active', endpoint: 'test-endpoint-active', model: 'gpt-test-active' };

    beforeEach(() => {
        mockFetch.mockReset();
        // Ensure the store is created with a valid initial model setup for the thunk to use getActiveModel
        store = createTestStore({ models: [mockModel], selectedModelId: mockModel.id });
    });

    it('Test Case 1a: fetchAutoDashboard success populates state correctly', async () => {
        const mockApiResponse = {
            status: 'ok',
            results: {
                sql_query: 'SELECT columnA FROM test_table_for_dashboard',
                data_content: { rows: [{ columnA: 10 }, { columnA: 20 }] },
                dashboard_suggestions: [{ recommendation: 'View columnA distribution', chart_type: 'histogram', visualization_fields: ['columnA'] }],
            },
        };
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockApiResponse,
        } as Response);

        // Need to cast to any for thunk dispatch in tests if types are tricky with ThunkAction
        await store.dispatch(fetchAutoDashboard(mockTableName) as any);

        const state = store.getState().dataFormulator;
        expect(state.isAutoDashboardLoading).toBe(false);
        expect(state.autoDashboardQuery).toEqual(mockApiResponse.results.sql_query);
        expect(state.autoDashboardData).toEqual(mockApiResponse.results.data_content.rows);
        expect(state.autoDashboardSuggestions).toEqual(mockApiResponse.results.dashboard_suggestions);
        expect(state.autoDashboardError).toBeNull();
    });

    it('Test Case 1b: fetchAutoDashboard handles API error', async () => {
        const mockApiErrorResponse = { message: 'Server Error Occurred' };
        mockFetch.mockResolvedValueOnce({
            ok: false, // Simulate an HTTP error status
            status: 500,
            json: async () => mockApiErrorResponse, // Simulate error response body
        } as Response);

        await store.dispatch(fetchAutoDashboard(mockTableName) as any);

        const state = store.getState().dataFormulator;
        expect(state.isAutoDashboardLoading).toBe(false);
        expect(state.autoDashboardError).toEqual('Server Error Occurred');
        expect(state.autoDashboardSuggestions).toBeNull(); // Ensure suggestions are cleared or not set
    });

    it('Test Case 1c: fetchAutoDashboard handles network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network request failed')); // Simulate fetch throwing an error

        await store.dispatch(fetchAutoDashboard(mockTableName) as any);

        const state = store.getState().dataFormulator;
        expect(state.isAutoDashboardLoading).toBe(false);
        expect(state.autoDashboardError).toEqual('Network request failed');
    });
    
    it('Test Case 1d: fetchAutoDashboard sets isLoading to true on pending', () => {
        // A promise that never resolves, to keep the thunk in a pending state
        mockFetch.mockReturnValueOnce(new Promise(() => {})); 

        store.dispatch(fetchAutoDashboard(mockTableName) as any);
        
        const state = store.getState().dataFormulator;
        expect(state.isAutoDashboardLoading).toBe(true);
        expect(state.autoDashboardError).toBeNull(); // Error should be null initially
    });
});

describe('dfSlice - applyDashboardSuggestionToWorkspace Reducer', () => {
    let store: EnhancedStore<{dataFormulator: DataFormulatorState}>;
    const initialTableId = 'initial_table_id_main';
    const initialChartId = 'initial_chart_id_main';

    const mockSuggestion = {
        chart_type: 'histogram',
        visualization_fields: ['age'], // x-axis
        recommendation: 'Distribution of Age',
        output_fields: ['age', 'count'], // Example output fields from the suggestion's perspective
    };
    const mockDashboardDataRows = [ // This is the data that will form the new table
        { age: 25, count_val: 10 }, // field names in rows should match visualization_fields
        { age: 30, count_val: 15 },
        { age: 35, count_val: 8 },
    ];

    beforeEach(() => {
        const initialTable = testCreateDictTableFromRows(initialTableId, [{ initialColName: 'initial_data_value' }]);
        const initialChart: Chart = { 
            ...generateFreshChart(initialTableId, 'line'), // Initial chart, e.g., a line chart
            id: initialChartId 
        };
        
        store = createTestStore({
            tables: [initialTable],
            charts: [initialChart],
            focusedTableId: initialTableId,
            focusedChartId: initialChartId,
            conceptShelfItems: testGetDataFieldItems(initialTable), // Concept items for the initial table
            autoDashboardData: mockDashboardDataRows, // Data that the suggestion is based on
        });
    });

    it('Test Case 2: applyDashboardSuggestionToWorkspace correctly updates workspace state', () => {
        store.dispatch(dfActions.applyDashboardSuggestionToWorkspace({
            suggestion: mockSuggestion,
            dashboardDataRows: mockDashboardDataRows,
        }));

        const state = store.getState().dataFormulator;

        // Verify new table was created and focused
        expect(state.tables.length).toBe(2); // Initial table + new one from dashboard data
        const newTable = state.tables.find(t => t.id !== initialTableId);
        expect(newTable).toBeDefined();
        expect(state.focusedTableId).toBe(newTable!.id);
        // Check names from the actual rows provided
        expect(newTable!.names.sort()).toEqual(['age', 'count_val'].sort()); 

        // Verify concept shelf items for the new table
        const newTableFieldItems = state.conceptShelfItems.filter(item => item.tableRef === newTable!.id);
        expect(newTableFieldItems.length).toBe(2); // age, count_val
        expect(newTableFieldItems.map(f => f.name).sort()).toEqual(['age', 'count_val'].sort());

        // Verify chart was updated (the one that was initially focused)
        const updatedChart = state.charts.find(c => c.id === initialChartId); 
        expect(updatedChart).toBeDefined();
        expect(updatedChart!.tableRef).toBe(newTable!.id); // Chart now refers to the new table
        expect(updatedChart!.chartType).toBe(mockSuggestion.chart_type); // Chart type updated

        // Verify encoding map for the histogram (typically x-axis for the field, y for count)
        const ageFieldItem = newTableFieldItems.find(f => f.name === 'age');
        expect(ageFieldItem).toBeDefined();
        // For histogram, primary field goes to 'x', and 'y' is often count (handled by Vega template or explicit encoding)
        expect(updatedChart!.encodingMap.x?.fieldID).toBe(ageFieldItem!.id); 
        // If `getChartChannels` for histogram implies y is count, it might be empty or set to a count aggregate.
        // This part depends on how `generateFreshChart` and `getChartChannels` setup encodings.
        // For this test, we primarily check the fieldID for the specified visualization_field.

        // Verify goal description
        expect(state.currentGoalDescription).toBe(mockSuggestion.recommendation);

        // Verify message was added
        expect(state.messages.length).toBeGreaterThan(0);
        const lastMessage = state.messages[state.messages.length - 1];
        expect(lastMessage.message).toContain("Applied suggested chart");
        expect(lastMessage.severity).toBe("info");
    });

    it('creates a new chart if no chart is initially focused or charts list is empty', () => {
        const emptyChartStore = createTestStore({
            tables: [], // Start with no tables
            charts: [], // No charts initially
            focusedTableId: undefined,
            focusedChartId: undefined,
            conceptShelfItems: [],
            autoDashboardData: mockDashboardDataRows, // This data will be used for the new table
        });

        emptyChartStore.dispatch(dfActions.applyDashboardSuggestionToWorkspace({
            suggestion: mockSuggestion,
            dashboardDataRows: mockDashboardDataRows,
        }));

        const state = emptyChartStore.getState().dataFormulator;
        
        expect(state.charts.length).toBe(1); // A new chart should be created
        const newChart = state.charts[0];
        expect(newChart.chartType).toBe(mockSuggestion.chart_type);
        
        expect(state.tables.length).toBe(1); // New table from dashboard data
        const newTable = state.tables[0];
        expect(newChart.tableRef).toBe(newTable.id); // Chart refers to this new table

        expect(state.focusedChartId).toBe(newChart.id);
        expect(state.focusedTableId).toBe(newTable.id);
    });
});
