// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react'; // Added useState for optional hide feature
import { useDispatch, useSelector } from 'react-redux';
import { Card, CardContent, Typography, Grid, Box, Paper, Button, IconButton } from '@mui/material'; // Added Button, IconButton
import { VegaLite } from 'react-vega';
import { TopLevelSpec } from 'vega-lite';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice'; // Added dfActions
import { assembleVegaChart } from '../app/utils'; 
import { FieldItem } from '../components/ComponentType';
import { AppDispatch } from '../app/store'; // For typed dispatch
import CloseIcon from '@mui/icons-material/Close'; // For optional hide button

interface DashboardDisplayProps {
    suggestions: any[]; 
    sqlQuery: string | null;
    data: any[] | null; 
}

const DashboardDisplay: FC<DashboardDisplayProps> = ({ suggestions, sqlQuery, data }) => {
    const dispatch = useDispatch<AppDispatch>();
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const allTables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);

    // Optional: State for hiding suggestions
    const [hiddenSuggestionIndices, setHiddenSuggestionIndices] = useState<number[]>([]);

    const handleUseThisChart = (suggestion: any) => {
        if (data) {
            dispatch(dfActions.applyDashboardSuggestionToWorkspace({ suggestion, dashboardDataRows: data }));
        } else {
            console.error("Dashboard data is not available to apply suggestion.");
            // Optionally, dispatch an error message to the user via Redux store
        }
    };

    // Optional: Handler for hiding a suggestion
    const handleHideSuggestion = (index: number) => {
        setHiddenSuggestionIndices(prev => [...prev, index]);
    };

    const getFieldItemByName = (fieldName: string, tableId: string | undefined): FieldItem | undefined => {
        if (!tableId) return undefined;
        // First try to find in conceptShelfItems by name and tableRef (if available)
        let field = conceptShelfItems.find(item => item.name === fieldName && item.tableRef === tableId);
        if (field) return field;

        // Fallback: if not in conceptShelfItems (e.g. direct fields from a table not yet fully conceptualized)
        // or if tableRef is not matching, try to construct a basic FieldItem from the table schema.
        const tableSchema = allTables.find(t => t.id === tableId);
        if (tableSchema) {
            const fieldIndex = tableSchema.names.indexOf(fieldName);
            if (fieldIndex !== -1) {
                return {
                    id: `dashboard-temp-${tableId}-${fieldName}`,
                    name: fieldName,
                    type: tableSchema.types[fieldIndex],
                    source: "original", // Assumption
                    tableRef: tableId,
                    description: "",
                    domain: [], // May need to compute if essential for assembleVegaChart
                };
            }
        }
        // If still not found, try a broader search in conceptShelfItems if tableId was generic
         field = conceptShelfItems.find(item => item.name === fieldName);
         if (field) return field;

        console.warn(`Field item not found for ${fieldName} in table ${tableId}`);
        return undefined;
    };


    if (!suggestions || suggestions.length === 0) {
        return <Typography sx={{ p: 2 }}>No dashboard suggestions available.</Typography>;
    }

    if (!data) {
        return <Typography sx={{ p: 2 }}>Data for dashboard is not available.</Typography>;
    }

    const visibleSuggestions = suggestions.filter((_, index) => !hiddenSuggestionIndices.includes(index));

    return (
        <Box sx={{ p: 2, flexGrow: 1 }}>
            {sqlQuery && (
                <Paper elevation={1} sx={{ mb: 2, p: 2, backgroundColor: 'grey.100' }}>
                    <Typography variant="h6" gutterBottom>SQL Query for Dashboard Data</Typography>
                    <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '150px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {sqlQuery}
                    </Typography>
                </Paper>
            )}
            <Grid container spacing={2}>
                {visibleSuggestions.map((suggestion, index) => { // Use visibleSuggestions
                    // Note: 'index' here is for the filtered list. If original index is needed for hiding, pass it down or adjust.
                    // For simplicity, we'll assume the button actions get the correct 'suggestion' object.
                    // If using original index for hiding from the button, it would be:
                    // const originalIndex = suggestions.findIndex(s => s === suggestion);

                    const chartType = suggestion.chart_type;
                    const visFields = suggestion.visualization_fields || []; 
                    
                    const encodingMap: any = {};
                    const channels = ['x', 'y', 'color', 'size', 'shape', 'detail']; // Add more as needed by chart types

                    visFields.forEach((fieldName: string, i: number) => {
                        if (i < channels.length) {
                            const channel = channels[i];
                            const fieldItem = getFieldItemByName(fieldName, focusedTableId);
                            if (fieldItem) {
                                encodingMap[channel] = { fieldID: fieldItem.id, aggregate: undefined }; // No aggregation by default for auto-dashboard
                            } else {
                                 // This case should ideally be rare if getFieldItemByName has a robust fallback.
                                 // If assembleVegaChart can handle fieldName directly, this might work, but it's less safe.
                                 // For now, we assume getFieldItemByName provides what's needed or assembleVegaChart is flexible.
                                 // Consider logging a warning if fieldItem is not found, as chart generation might fail.
                                 console.warn(`FieldItem for '${fieldName}' not found, chart may not render correctly.`);
                                 encodingMap[channel] = { fieldName: fieldName, aggregate: undefined }; 
                            }
                        }
                    });
                    
                    // Construct a simplified encodingMap for assembleVegaChart
                    const encodingMap: any = {};
                    const channels = ['x', 'y', 'color', 'size', 'shape', 'detail']; 

                    visFields.forEach((fieldName: string, i: number) => {
                        if (i < channels.length) {
                            const channel = channels[i];
                            const fieldItem = getFieldItemByName(fieldName, focusedTableId);
                            if (fieldItem) {
                                encodingMap[channel] = { fieldID: fieldItem.id, aggregate: undefined }; 
                            } else {
                                 console.warn(`FieldItem for '${fieldName}' not found, chart may not render correctly.`);
                                 encodingMap[channel] = { fieldName: fieldName, aggregate: undefined }; 
                            }
                        }
                    });
                    
                    let spec: TopLevelSpec | null = null;
                    try {
                        if (Object.keys(encodingMap).length > 0 && data.length > 0) {
                            const relevantFieldItems = visFields
                                .map((fieldName: string) => getFieldItemByName(fieldName, focusedTableId))
                                .filter((item: FieldItem | undefined) => item !== undefined) as FieldItem[];

                            const chartAssemblyResult = assembleVegaChart(chartType, encodingMap, relevantFieldItems, data);
                            if (typeof chartAssemblyResult === 'object' && chartAssemblyResult !== null && chartAssemblyResult.data) {
                                spec = chartAssemblyResult as TopLevelSpec;
                            } 
                        }
                    } catch (e) {
                        console.error("Error assembling Vega chart:", e);
                    }
                    
                    // Find original index for hiding
                    const originalIndex = suggestions.findIndex(s => s === suggestion);

                    return (
                        <Grid item xs={12} sm={6} md={4} key={originalIndex /* Use originalIndex for key if filtering */}>
                            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                                {/* Optional: Hide button */}
                                <IconButton 
                                    aria-label="hide suggestion"
                                    onClick={() => handleHideSuggestion(originalIndex)}
                                    sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                                >
                                    <CloseIcon fontSize="small" />
                                </IconButton>
                                <CardContent sx={{ flexGrow: 1 }}>
                                    <Typography variant="subtitle1" gutterBottom component="div" sx={{pr: 4 /* padding for hide button */}}>
                                        {suggestion.recommendation || 'Visualization Suggestion'}
                                    </Typography>
                                    <Box sx={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed grey', borderRadius: 1, mb:1 }}>
                                        {spec ? (
                                            <VegaLite spec={spec} actions={false} />
                                        ) : (
                                            <Typography variant="caption">Chart preview not available.</Typography>
                                        )}
                                    </Box>
                                </CardContent>
                                <CardContent sx={{pt:0}}>
                                     <Typography variant="body2" color="text.secondary">
                                        Chart Type: {chartType}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" gutterBottom>
                                        Fields: {visFields.join(', ')}
                                    </Typography>
                                    <Button 
                                        variant="outlined" 
                                        size="small" 
                                        onClick={() => handleUseThisChart(suggestion)}
                                        fullWidth
                                    >
                                        Use this Chart
                                    </Button>
                                </CardContent>
                            </Card>
                        </Grid>
                    );
                })}
            </Grid>
        </Box>
    );
};

export default DashboardDisplay;
