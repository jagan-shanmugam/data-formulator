// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore, EnhancedStore } from '@reduxjs/toolkit';
import DashboardDisplay from './DashboardDisplay';
import { 
    dataFormulatorReducer, 
    DataFormulatorState, 
    dfActions, 
    initialState as dfInitialState 
} from '../app/dfSlice';
import { FieldItem, DictTable, Type as DfType } from '../components/ComponentType';

// Mock VegaLite component
jest.mock('react-vega', () => ({
    VegaLite: jest.fn(() => <div data-testid="mock-vega-lite-chart">Mock Chart</div>),
}));

// Mock assembleVegaChart utility
// It needs to return a valid Vega-Lite spec object for the chart to be "rendered"
// or null/undefined if it's supposed to fail for a test case.
const mockAssembleVegaChart = jest.fn();
jest.mock('../app/utils', () => ({ // Ensure the path to utils is correct
    ...jest.requireActual('../app/utils'), 
    assembleVegaChart: (...args: any[]) => mockAssembleVegaChart(...args),
}));


const mockInitialTable: DictTable = { // This table represents the initially focused table in the app
    id: 'initial-table-1',
    displayId: 'Initial Table 1',
    names: ['product', 'sales', 'region', 'age'], // Added 'age' to match mockData if needed for getFieldItemByName
    types: [DfType.String, DfType.Number, DfType.String, DfType.Number],
    rows: [
        { product: 'A', sales: 100, region: 'North', age: 30 },
        { product: 'B', sales: 150, region: 'South', age: 40 },
    ],
    anchored: true,
};

// These conceptShelfItems should reflect the columns of mockInitialTable, 
// and any fields that might be present in mockData for the dashboard suggestions.
const mockConceptShelfItems: FieldItem[] = [
    { id: 'field-product-initial', name: 'product', type: DfType.String, source: 'original', tableRef: 'initial-table-1', domain: ['A', 'B'] , description: ''},
    { id: 'field-sales-initial', name: 'sales', type: DfType.Number, source: 'original', tableRef: 'initial-table-1', domain: [100, 150], description: '' },
    { id: 'field-region-initial', name: 'region', type: DfType.String, source: 'original', tableRef: 'initial-table-1', domain: ['North', 'South'], description: '' },
    // Assuming 'total_sales' and 'age' might come from the dashboard's data,
    // and getFieldItemByName might need to construct FieldItems for them if they are not in the initial table's conceptShelfItems.
    // For robust testing, ensure getFieldItemByName in DashboardDisplay can handle fields present in `mockData`
    // even if they are not directly in `mockConceptShelfItems` for `initial-table-1`.
    // The `getFieldItemByName` in `DashboardDisplay` has a fallback to create basic FieldItems.
    { id: 'field-total_sales-dashboard', name: 'total_sales', type: DfType.Number, source: 'original', tableRef: 'dashboard_data_source_table', domain: [100, 150, 200], description: ''},
    { id: 'field-age-dashboard', name: 'age', type: DfType.Number, source: 'original', tableRef: 'dashboard_data_source_table', domain: [25,30,35], description: ''},

];


const mockSuggestions = [
    {
        chart_type: 'bar',
        visualization_fields: ['product', 'total_sales'], // x, y. 'total_sales' might be from the new dashboard data
        recommendation: 'Bar chart of total sales by product',
        mode: 'summary',
        output_fields: ['product', 'total_sales'],
    },
    {
        chart_type: 'pie',
        visualization_fields: ['region', 'total_sales'], // label, value
        recommendation: 'Pie chart of total sales by region',
        mode: 'summary',
        output_fields: ['region', 'total_sales'],
    },
];

const mockSqlQuery = 'SELECT product, region, SUM(sales) AS total_sales FROM sales_data GROUP BY product, region;';
// This data is what `autoDashboardData` (the `data` prop) will be.
// Its fields should be resolvable by `getFieldItemByName` in DashboardDisplay.
const mockData = [
    { product: 'Apples', region: 'North', total_sales: 120, age: 25 }, // Added 'age' for potential diversity
    { product: 'Bananas', region: 'South', total_sales: 180, age: 30 },
];

// Helper to create a new store for each test, preloaded with necessary state
const createTestStore = (preloadedState?: Partial<DataFormulatorState>): EnhancedStore<{dataFormulator: DataFormulatorState}> => {
    // Merge provided preloadedState with a baseline that includes necessary items like conceptShelfItems
    const fullPreloadedState = { 
        ...dfInitialState, 
        tables: [mockInitialTable], // Ensure there's at least one table if components rely on it
        conceptShelfItems: mockConceptShelfItems, 
        focusedTableId: mockInitialTable.id, // Set a focused table
        ...preloadedState 
    };
    return configureStore({
        reducer: {
            dataFormulator: dataFormulatorReducer,
        },
        preloadedState: { dataFormulator: fullPreloadedState },
    });
};

describe('DashboardDisplay Component', () => {
    let store: EnhancedStore<{dataFormulator: DataFormulatorState}>;

    beforeEach(() => {
        store = createTestStore();
        mockAssembleVegaChart.mockReset().mockImplementation((chartType, encodingMap, fieldItems, data) => {
            // Ensure fieldItems are provided and have names for robust testing
            if (chartType && data && data.length > 0 && fieldItems && fieldItems.length > 0 && fieldItems.every(fi => fi && fi.name)) {
                return { 
                    data: { values: data },
                    mark: chartType,
                    encoding: {}, // Simplified encoding for mock
                    width: 150, height: 150, 
                };
            }
            return null; 
        });
    });

    it('Test Case 1: Renders suggestions correctly', () => {
        render(
            <Provider store={store}>
                <DashboardDisplay suggestions={mockSuggestions} sqlQuery={mockSqlQuery} data={mockData} />
            </Provider>
        );

        expect(screen.getByText('SQL Query for Dashboard Data')).toBeInTheDocument();
        expect(screen.getByText(mockSqlQuery)).toBeInTheDocument();

        mockSuggestions.forEach(suggestion => {
            expect(screen.getByText(suggestion.recommendation)).toBeInTheDocument();
        });
        
        const useChartButtons = screen.getAllByRole('button', { name: /Use this Chart/i });
        expect(useChartButtons.length).toBe(mockSuggestions.length);

        const hideButtons = screen.getAllByRole('button', { name: /hide suggestion/i });
        expect(hideButtons.length).toBe(mockSuggestions.length);

        // Check that assembleVegaChart was called for each suggestion
        // The DashboardDisplay's getFieldItemByName will try to find 'product', 'total_sales', 'region'
        // from the global conceptShelfItems or construct them based on `focusedTableId` and `mockData` schema.
        expect(mockAssembleVegaChart).toHaveBeenCalledTimes(mockSuggestions.length);

        const mockCharts = screen.getAllByTestId('mock-vega-lite-chart');
        expect(mockCharts.length).toBe(mockSuggestions.length); 
    });

    it('Test Case 2: "Use this Chart" button click dispatches action', () => {
        const dispatchSpy = jest.spyOn(store, 'dispatch');

        render(
            <Provider store={store}>
                <DashboardDisplay suggestions={[mockSuggestions[0]]} sqlQuery={mockSqlQuery} data={mockData} />
            </Provider>
        );

        const useThisChartButton = screen.getByRole('button', { name: /Use this Chart/i });
        fireEvent.click(useThisChartButton);

        expect(dispatchSpy).toHaveBeenCalledTimes(1);
        expect(dispatchSpy).toHaveBeenCalledWith(
            dfActions.applyDashboardSuggestionToWorkspace({
                suggestion: mockSuggestions[0],
                dashboardDataRows: mockData,
            })
        );
        dispatchSpy.mockRestore();
    });

    it('Test Case 3: "Hide" button click removes the card', async () => {
        render(
            <Provider store={store}>
                <DashboardDisplay suggestions={mockSuggestions} sqlQuery={mockSqlQuery} data={mockData} />
            </Provider>
        );

        expect(screen.getByText(mockSuggestions[0].recommendation)).toBeInTheDocument();
        expect(screen.getByText(mockSuggestions[1].recommendation)).toBeInTheDocument();

        const hideButtons = screen.getAllByRole('button', { name: /hide suggestion/i });
        
        await act(async () => { 
            fireEvent.click(hideButtons[0]);
        });

        expect(screen.queryByText(mockSuggestions[0].recommendation)).not.toBeInTheDocument();
        expect(screen.getByText(mockSuggestions[1].recommendation)).toBeInTheDocument();
        
        const remainingCharts = screen.getAllByTestId('mock-vega-lite-chart');
        expect(remainingCharts.length).toBe(mockSuggestions.length - 1);
    });

    it('handles null data by showing "Data not available" message', () => {
        render(
            <Provider store={store}>
                <DashboardDisplay suggestions={mockSuggestions} sqlQuery={mockSqlQuery} data={null} />
            </Provider>
        );
        expect(screen.getByText('Data for dashboard is not available.')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-vega-lite-chart')).not.toBeInTheDocument();
    });
    
    it('handles empty suggestions array by showing "No suggestions" message', () => {
        render(
            <Provider store={store}>
                <DashboardDisplay suggestions={[]} sqlQuery={mockSqlQuery} data={mockData} />
            </Provider>
        );
        expect(screen.getByText('No dashboard suggestions available.')).toBeInTheDocument();
    });

    it('renders "Chart preview not available" if assembleVegaChart returns null', () => {
        mockAssembleVegaChart.mockReturnValue(null); // Ensure it returns null for this test
        render(
            <Provider store={store}>
                <DashboardDisplay suggestions={[mockSuggestions[0]]} sqlQuery={mockSqlQuery} data={mockData} />
            </Provider>
        );
        expect(screen.getByText('Chart preview not available.')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-vega-lite-chart')).not.toBeInTheDocument();
    });
});
