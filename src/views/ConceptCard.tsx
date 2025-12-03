// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useDrag } from 'react-dnd'
import { useSelector, useDispatch } from 'react-redux'

import '../scss/ConceptShelf.scss';

import 'prismjs/components/prism-python' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another
import { useTheme } from '@mui/material/styles';

import {
    Chip,
    Card,
    Box,
    CardContent,
    Typography,
    IconButton,
    Button,
    TextField,
    FormControl,
    InputLabel,
    SelectChangeEvent,
    MenuItem,
    Checkbox,
    Menu,
    ButtonGroup,
    Tooltip,
    styled,
    LinearProgress,
    Dialog,
    FormControlLabel,
    DialogActions,
    DialogTitle,
    DialogContent,
    Divider,
    Select,
    SxProps,
} from '@mui/material';

import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import ForkRightIcon from '@mui/icons-material/ForkRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import HideSourceIcon from '@mui/icons-material/HideSource';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import AnimateHeight from 'react-animate-height';

import { FieldItem, ConceptTransformation, duplicateField, FieldSource } from '../components/ComponentType';

import {  testType, Type, TypeList } from "../data/types";
import React from 'react';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';

import { getUrls } from '../app/utils';
import { getIconFromType } from './ViewUtils';


import _ from 'lodash';
import { DictTable } from '../components/ComponentType';
import { CodeBox } from './VisualizationView';
import { CustomReactTable } from './ReactTable';
import { alpha } from '@mui/material/styles';

export interface ConceptCardProps {
    field: FieldItem,
    sx?: SxProps
}



export const ConceptCard: FC<ConceptCardProps> = function ConceptCard({ field, sx }) {
    // concept cards are draggable cards that can be dropped into encoding shelf
    let theme = useTheme();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    
    let focusedTable = tables.find(t => t.id == focusedTableId);

    const [editMode, setEditMode] = useState(field.name == "" ? true : false);

    const dispatch = useDispatch();
    let handleDeleteConcept = (conceptID: string) => dispatch(dfActions.deleteConceptItemByID(conceptID));
    let handleUpdateConcept = (concept: FieldItem) => dispatch(dfActions.updateConceptItems(concept));

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "concept-card",
        item: { type: 'concept-card', fieldID: field.id, source: "conceptShelf" },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
            handlerId: monitor.getHandlerId(),
        }),
    }));

    let [isLoading, setIsLoading] = useState(false);
    let handleLoading = (loading: boolean) => {
        setIsLoading(loading);
    }
    
    let opacity = isDragging ? 0.3 : 1;
    let fontStyle = "inherit";
    let border = "hidden";

    const cursorStyle = isDragging ? "grabbing" : "grab";

    let deleteOption = !(field.source == "original") && <IconButton size="small"
            key="delete-icon-button"
            color="primary" aria-label="Delete" component="span"
            onClick={() => { handleDeleteConcept(field.id); }}>
            <DeleteIcon fontSize="inherit" />
        </IconButton>;

    let cardHeaderOptions = [
        deleteOption,
    ]

    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const handleDTypeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };
    const handleDTypeClose = () => {
        setAnchorEl(null);
    };

    let typeIcon = (
        <IconButton size="small" sx={{ fontSize: "inherit", padding: "2px" }}
            color="primary" component="span"
            aria-controls={open ? 'basic-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={open ? 'true' : undefined}
        >
            {getIconFromType(focusedTable?.metadata[field.name]?.type || Type.Auto)}
        </IconButton>
    )

    let fieldNameEntry = field.name != "" ? <Typography sx={{
        fontSize: "inherit", marginLeft: "3px", whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1
    }}>{field.name}</Typography>
        : <Typography sx={{ fontSize: 12, marginLeft: "3px", color: "gray", fontStyle: "italic" }}>new concept</Typography>;

    let backgroundColor = theme.palette.primary.main;
    if (field.source == "original") {
        backgroundColor = theme.palette.primary.light;
    } else if (field.source == "custom") {
        backgroundColor = theme.palette.custom.main;
    } else if (field.source == "derived") {
        backgroundColor = theme.palette.derived.main;
    }

    let draggleCardHeaderBgOverlay = 'rgba(255, 255, 255, 0.9)';

    // Add subtle tint for non-focused fields
    if (focusedTable && !focusedTable.names.includes(field.name)) {
        draggleCardHeaderBgOverlay = 'rgba(255, 255, 255, 1)';
    }

    let boxShadow = editMode ? "0 2px 4px 0 rgb(0 0 0 / 20%), 0 2px 4px 0 rgb(0 0 0 / 19%)" : "";

    let cardComponent = (
        <Card sx={{ minWidth: 60, backgroundColor, position: "relative", ...sx }}
            variant="outlined"
            style={{ opacity, border, boxShadow, fontStyle, marginLeft: '3px' }}
            color="secondary"
            className={`data-field-list-item draggable-card`}>
            {isLoading ? <Box sx={{ position: "absolute", zIndex: 20, height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.2 }} />
            </Box> : ""}
            <Box ref={field.name ? drag : undefined} sx={{ cursor: cursorStyle, background: draggleCardHeaderBgOverlay }}
                 className={`draggable-card-header draggable-card-inner ${field.source}`}>
                <Typography className="draggable-card-title" color="text.primary"
                    sx={{ fontSize: 12, height: 24, width: "100%"}} component={'span'} gutterBottom>
                    {typeIcon}
                    {fieldNameEntry}
                    {focusedTable?.metadata[field.name]?.semanticType ? 
                        <Typography sx={{fontSize: "xx-small", color: "text.secondary", marginLeft: "6px", fontStyle: 'italic', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
                            <ArrowRightIcon sx={{fontSize: "12px"}} /> {focusedTable?.metadata[field.name].semanticType}</Typography> : ""}
                </Typography>
                
                <Box sx={{ position: "absolute", right: 0, display: "flex", flexDirection: "row", alignItems: "center" }}>
                    <Box className='draggable-card-action-button' sx={{ background: 'rgba(255, 255, 255, 0.95)'}}>{cardHeaderOptions}</Box>
                </Box>
            </Box>
        </Card>
    )

    return cardComponent;
}

export interface ConceptFormProps {
    concept: FieldItem,
    handleUpdateConcept: (conept: FieldItem) => void,
    handleDeleteConcept: (conceptID: string) => void,
    turnOffEditMode?: () => void,
}

export interface CodexDialogBoxProps {
    inputData: {name: string, rows: any[]},
    outputName: string,
    inputFields: {name: string}[],
    initialDescription: string,
    callWhenSubmit: (desc: string) => void,
    handleProcessResults: (status: string, results: {code: string, content: any[]}[]) => void, // return processed cnadidates for the ease of logging
    size: "large" | "small",
}


export const PyCodexDialogBox: FC<CodexDialogBoxProps> = function ({ 
    initialDescription, inputFields, inputData, outputName, callWhenSubmit, handleProcessResults, size="small" }) {

    let activeModel = useSelector(dfSelectors.getActiveModel);

    let [description, setDescription] = useState(initialDescription);
    let [requestTimeStamp, setRequestTimeStamp] = useState<number>(0);

    let defaultInstruction = `Derive ${outputName} from ${inputFields.map(f => f.name).join(", ")}`;

    let formulateButton = <Tooltip title="Derived the new concept">
        <IconButton size={size}
            disabled={description == ""}
            sx={{ borderRadius: "10%", alignItems: "flex-end", position: 'relative' }}
            color="primary" aria-label="Edit" component="span" onClick={() => {

                setRequestTimeStamp(Date.now());
                //setTransformCode("");

                console.log(`[fyi] just sent request "${description}" at ${requestTimeStamp}`);

                let message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({
                        token: requestTimeStamp,
                        description: description,
                        input_fields: inputFields,
                        input_data: inputData,
                        output_name: outputName,
                        model: activeModel
                    }),
                };

                callWhenSubmit(description);

                // timeout the request after 20 seconds
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 20000)

                fetch(getUrls().DERIVE_PY_CONCEPT, {...message, signal: controller.signal })
                    .then((response) => response.json())
                    .then((data) => {
                        let candidates = data["results"].filter((r: any) => r["status"] == "ok");
                        handleProcessResults(data["status"], candidates);
                    }).catch((error) => {
                        handleProcessResults("error", []);
                    });
            }}>
            <PrecisionManufacturingIcon />
        </IconButton>
    </Tooltip>

    let textBox = <Box key="interaction-comp" width='100%' sx={{ display: 'flex', flexDirection: "column" }}>
        <Typography style={{ fontSize: "9px", color: "gray" }}>transformation prompt</Typography>
        <TextField 
            size="small"
            sx={{fontSize: 12}}
            color="primary"
            fullWidth
            disabled={outputName == ""}
            slotProps={{
                input: { endAdornment: formulateButton, },
                inputLabel: { shrink: true }
            }}
            multiline
            onKeyDown={(event: any) => {
                if (event.key === "Enter" || event.key === "Tab") {
                    // write your functionality here
                    let target = event.target as HTMLInputElement;
                    if (target.value == "" && target.placeholder != "") {
                        target.value = target.placeholder;
                        setDescription(defaultInstruction);
                        event.preventDefault();
                    }
                }
            }}
            value={description}
            placeholder={defaultInstruction} onChange={(event: any) => { setDescription(event.target.value) }}
            variant="standard"  
        />
    </Box>

    return textBox;
}
