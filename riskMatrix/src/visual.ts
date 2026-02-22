"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import * as d3 from "d3";
import { create_base_matrix } from "./helper";
import type { MatrixCell, MatrixData } from "./helper";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

interface Risk {
    category: string;
    consequenceIdx: number; // 1–5
    likelihoodIdx: number;  // 1–5
    selectionId?: powerbi.extensibility.ISelectionId;
    consequenceLabel?: string;
    likelihoodLabel?: string;
    jitterX?: number;
    jitterY?: number;
    radius?: number;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;

    private _container: HTMLDivElement;

    private margin_top = 40;
    private margin_bottom = 40;
    private margin_left = 60;
    private margin_right = 40;

    private riskConsequenceLevels = ["Insignificant","Minor","Moderate","Major","Catastrophic"];
    private riskLikelihoodLevels = ["Rare","Unlikely","Possible","Likely","Almost Certain"];

    private fallbackColourArray = ["#33CC33", "#FFCC00", "#FFA500", "#FF3333"];

    private risks: Risk[] = [];
    private data: MatrixData;

    private host: powerbi.extensibility.visual.IVisualHost;
    private selectionManager: powerbi.extensibility.ISelectionManager;
    private colourPalette: powerbi.extensibility.IColorPalette | undefined;

    // persistent SVG layers (G group container)
    private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private rootG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private axesG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private cellsG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private pointsG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private labelsG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private titleG!: d3.Selection<SVGTextElement, unknown, null, undefined>;
    private xAxisTitleG!: d3.Selection<SVGTextElement, unknown, null, undefined>;
    private yAxisTitleG!: d3.Selection<SVGTextElement, unknown, null, undefined>;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();

        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.colourPalette = this.host.colorPalette;

        this._container = document.createElement("div");
        this._container.style.position = "relative";
        this._container.style.width = "100%";
        this._container.style.height = "100%";
        this.target.appendChild(this._container);

        this.svg = d3.select(this._container)
            .append("svg")
            .attr("role", "img")
            .attr("aria-label", "Risk Matrix");

        // use group layering
        this.rootG = this.svg.append("g").attr("class", "chart-root");
        this.axesG = this.rootG.append("g").attr("class", "axes");
        this.cellsG = this.rootG.append("g").attr("class", "cells");
        this.pointsG = this.rootG.append("g").attr("class", "points");
        this.labelsG = this.rootG.append("g").attr("class", "labels");

        // add titles
        this.titleG = this.svg.append("text")
            .attr("class", "chart-title")
            .attr("text-anchor", "middle")
            .attr("font-weight", "bold");
        
        this.xAxisTitleG = this.svg.append("text")
            .attr("class", "axis-title x")
            .attr("text-anchor", "middle");

        this.yAxisTitleG = this.svg.append("text")
            .attr("class", "axis-title y")
            .attr("text-anchor", "middle")
            .attr("transform", "rotate(-90)");

        this.data = create_base_matrix();
    }

    public update(options: VisualUpdateOptions) {
        if (!options.dataViews || options.dataViews.length === 0) return;

        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews[0]
        );

        this.extractData(options.dataViews[0]);

        this.renderChart(options);
    }

    // clamp indices to keep within bounds
    private clampIndex(v: any, min = 1, max = 5): number | null {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        const f = Math.floor(n);
        if (f < min || f > max) return null;
        return f;
    }

    private extractData(dataView: DataView) {
        const table = dataView.table;
        if (!table || !table.rows || !table.columns) {
            this.risks = [];
            return;
        };

        const labelIdx = table.columns.findIndex(c => c.roles["riskLabel"]);
        const consequenceIdx = table.columns.findIndex(c => c.roles["riskConsequenceRating"]);
        const likelihoodIdx = table.columns.findIndex(c => c.roles["riskLikelihoodRating"]);

        if (labelIdx < 0 || consequenceIdx < 0 || likelihoodIdx < 0) {
            this.risks = [];
            return;
        }

        // selectionIdBuilder -> FOR FUTURE DEVELOPMENT
        // cross-filter -> change to categorical mapping
        const baseSelectionId = this.host.createSelectionIdBuilder().createSelectionId();

        this.risks = table.rows.map(row => {
            
            const cIdx = this.clampIndex(row[consequenceIdx]);
            const lIdx = this.clampIndex(row[likelihoodIdx]);

            if (cIdx == null || lIdx == null) return null;

            const category = row[labelIdx] != null ? String(row[labelIdx]): "N/A";

            return {
                category,
                consequenceIdx: cIdx,
                likelihoodIdx: lIdx,
                selectionId: baseSelectionId
            } as Risk;
        }).filter(
            (r): r is Risk => r != null
        );
    }

    private consequenceLabelFromIndex(key: number): string | null {
        return this.riskConsequenceLevels[key - 1] ?? null;
    }
    private likelihoodLabelFromIndex(key: number): string | null {
        return this.riskLikelihoodLevels[key - 1] ?? null;
    }

    // map low/med/high/catas to colour palatte

    private findCellColour(idx: number): string {
        const keys = ["risk-low", "risk-moderate", "risk-high", "risk-extreme"];
        const chosenKey = keys[idx] ?? `risk-${idx}`;
        const col = this.colourPalette.getColor(chosenKey);
        return col?.value
    }

    // calculate jitter
    /*
    private calculateJitter(
        x: d3.ScaleBand<string>,
        y: d3.ScaleBand<string>,
        width: number,
        height: number
    ): Risk[] {
        const cellGroups = d3.group(
            this.risks,
            d => `${d.consequenceIdx}-${d.likelihoodIdx}`
        );

        const cellWidth = Math.max(1, x.bandwidth());
        const cellHeight = Math.max(1, y.bandwidth());

        // calculate circle radius
        const baseRadius = Math.max(2, Math.min(cellWidth, cellHeight) * 0.09);
        const paddingInCell = Math.max(1, Math.min(cellWidth, cellHeight) * 0.35);
        const maxJitterX = (cellWidth / 2) - baseRadius - paddingInCell;
        const maxJitterY = (cellHeight / 2) - baseRadius - paddingInCell;

        // Helper to distribute n points in rings within available jitter box
        function jitterPositions(n: number): [number, number][] {
            if (n <= 1) return [[0, 0]];
            const positions: [number, number][] = [];
            const rings = Math.ceil(Math.sqrt(n));
            let placed = 0;

            for (let r = 0; r < rings && placed < n; r++) {
                const k = r === 0 ? 1 : Math.ceil(2 * Math.PI * (r + 1));
                for (let i = 0; i < k && placed < n; i++) {
                    const t = (i / k) * 2 * Math.PI;
                    const scale = (r + 1) / rings;
                    const increaseSpreadFactor = 1.15;
                    const jx = Math.max(-maxJitterX, Math.min(maxJitterX, increaseSpreadFactor * scale * maxJitterX * Math.cos(t)));
                    const jy = Math.max(-maxJitterY, Math.min(maxJitterY, increaseSpreadFactor * scale * maxJitterY * Math.sin(t)));
                    positions.push([jx, jy]);
                    placed++;
                }
            }
            return positions;
        }

        const jittered: Risk[] = [];

        for (const [key, group] of cellGroups.entries()) {
            const [cIdxStr, lIdxStr] = key.split("-");
            const cIdx = Number(cIdxStr);
            const lIdx = Number(lIdxStr);
            const cLabel = this.consequenceLabelFromIndex(cIdx);
            const lLabel = this.likelihoodLabelFromIndex(lIdx);
            if (!cLabel || !lLabel) continue;

            const pos = jitterPositions(group.length);
            for (let i = 0; i < group.length; i++) {
                const g = group[i];
                jittered.push({
                    ...g,
                    consequenceLabel: cLabel,
                    likelihoodLabel: lLabel,
                    jitterX: pos[i][0],
                    jitterY: pos[i][1],
                    radius: baseRadius
                });
            }
        }

        return jittered;
    }
        */

    // REPLACE your calculateJitter with this version
    private calculateJitter(
        x: d3.ScaleBand<string>,
        y: d3.ScaleBand<string>,
        width: number,
        height: number
    ): Risk[] {
        const cellGroups = d3.group(
            this.risks,
            d => `${d.consequenceIdx}-${d.likelihoodIdx}`
        );

        const cellW = Math.max(1, x.bandwidth());
        const cellH = Math.max(1, y.bandwidth());

        // Slightly smaller base radius to allow more breathing room between points
        const baseRadius = Math.max(4, Math.min(cellW, cellH) * 0.10);

        // Target spacing between centers (>= diameter gives no overlap)
        const gap = Math.max(2, baseRadius * 0.6);
        const pitchX = (baseRadius * 2) + gap;
        const pitchY = (baseRadius * 2) + gap;

        // Inner padding so dots never touch the cell border
        const innerPadX = Math.max(2, baseRadius + gap * 0.75);
        const innerPadY = Math.max(2, baseRadius + gap * 0.75);

        // Compute how many columns/rows we can fit
        const usableW = Math.max(0, cellW - innerPadX * 2);
        const usableH = Math.max(0, cellH - innerPadY * 2);
        const maxCols = Math.max(1, Math.floor(usableW / pitchX));
        const maxRows = Math.max(1, Math.floor(usableH / pitchY));

        // Helper: generate center positions for n items in a grid, centered within the cell
        function gridPositions(n: number): [number, number][] {
            const positions: [number, number][] = [];
            // If we can’t fit at least 1×1 with the current pitch, fallback to center
            if (maxCols === 1 && maxRows === 1) {
                for (let i = 0; i < n; i++) positions.push([0, 0]);
                return positions;
            }

            // Grow from 1..min(n, maxCols*maxRows)
            const cols = Math.min(maxCols, Math.ceil(Math.sqrt(n)));
            const rows = Math.min(maxRows, Math.ceil(n / cols));

            const gridW = (cols - 1) * pitchX;
            const gridH = (rows - 1) * pitchY;

            // Center grid in cell
            const cx0 = -gridW / 2;
            const cy0 = -gridH / 2;

            // Fill in row-major order. If n exceeds capacity, we wrap (keeps determinism).
            for (let i = 0; i < n; i++) {
                const r = Math.floor(i / cols) % rows;
                const c = i % cols;
                positions.push([cx0 + c * pitchX, cy0 + r * pitchY]);
            }
            return positions;
        }

        const placed: Risk[] = [];

        for (const [key, group] of cellGroups.entries()) {
            const [cIdxStr, lIdxStr] = key.split("-");
            const cIdx = Number(cIdxStr);
            const lIdx = Number(lIdxStr);
            const cLabel = this.consequenceLabelFromIndex(cIdx);
            const lLabel = this.likelihoodLabelFromIndex(lIdx);
            if (!cLabel || !lLabel) continue;

            const pos = gridPositions(group.length);

            for (let i = 0; i < group.length; i++) {
                const g = group[i];
                placed.push({
                    ...g,
                    consequenceLabel: cLabel,
                    likelihoodLabel: lLabel,
                    // Center of cell + offset from grid
                    jitterX: pos[i][0],
                    jitterY: pos[i][1],
                    radius: baseRadius
                });
            }
        }

        return placed;
    }


    private renderChart(options: VisualUpdateOptions) {
        
        const vport = options.viewport;
        const fullWidth = Math.max(0, vport.width);
        const fullHeight = Math.max(0, vport.height);

        const width = Math.max(0, fullWidth - (this.margin_left + this.margin_right));
        const height = Math.max(0, fullHeight - (this.margin_top + this.margin_bottom));

        this.svg
            .attr("width", fullWidth)
            .attr("height", fullHeight)
            .attr("viewBox", `0 0 ${fullWidth} ${fullHeight}`);

        this.rootG.attr("transform", `translate(${this.margin_left}, ${this.margin_top})`);

        const titleText = (this.formattingSettings as any)?.title?.text?.value ?? "Risk Matrix";
        const titleFontSize = (this.formattingSettings as any)?.title?.fontSize?.value ?? 20;

        this.titleG
            .text(titleText)
            .attr("x", fullWidth / 2)
            .attr("y", Math.max(20, this.margin_top * 0.6))
            .attr("font-size", `${titleFontSize}px`);

        const xAxisTitle = "Consequence";
        const yAxisTitle = "Likelihood";

        this.xAxisTitleG
            .text(xAxisTitle)
            .attr("x", this.margin_left + width / 2)
            .attr("y", fullHeight - Math.max(10, this.margin_bottom * 0.3))
            .attr("font-size", "12px");

        this.yAxisTitleG
            .text(yAxisTitle)
            .attr("x", -(this.margin_top + height / 2))
            .attr("y", Math.max(16, this.margin_left * 0.4))
            .attr("font-size", "12px");

        const x = d3.scaleBand<string>()
            .domain(this.riskConsequenceLevels)
            .range([0, width])
            .padding(0.03);

        const y = d3.scaleBand<string>()
            .domain(this.riskLikelihoodLevels)
            .range([height, 0])
            .padding(0.03);

        this.axesG.selectAll("*").remove();

        this.axesG.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0, ${height})`)
            .call(d3.axisBottom(x));

        this.axesG.append("g")
            .attr("class", "y-axis")
            .call(d3.axisLeft(y));

        const cells = this.cellsG
            .selectAll<SVGRectElement, MatrixCell>("rect.cell")
            .data(this.data, (d: any) => `${d.consequence}|${d.likelihood}`);

        cells.join(
            enter => enter.append("rect")
                .attr("class", "cell")
                .attr("x", d => x(d.consequence)!)
                .attr("y", d => y(d.likelihood)!)
                .attr("width", x.bandwidth())
                .attr("height", y.bandwidth())
                .attr("fill", d => this.fallbackColourArray[d.colour])
                .attr("stroke", "#eeeeee")
                .attr("stroke-width", 1),
            update => update
                .attr("x", d => x(d.consequence)!)
                .attr("y", d => y(d.likelihood)!)
                .attr("width", x.bandwidth())
                .attr("height", y.bandwidth()),
            exit => exit.remove()
            );

        const jitteredRisks = this.calculateJitter(x, y, width, height);

        const pointColour = (this.formattingSettings as any)?.points?.color?.value ?? "#1f77b4";

        const points = this.pointsG
            .selectAll<SVGCircleElement, Risk>("circle.risk-point")
            .data(jitteredRisks, (d: any) => `${d.category}-${d.consequenceIdx}-${d.likelihoodIdx}`);

        points.join(
            enter => enter.append("circle")
                .attr("class", "risk-point")
                .attr("r", d => d.radius!)
                .attr("cx", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("cy", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0))
                .attr("fill", pointColour)
                .attr("opacity", 0.9)
                .style("cursor", "pointer")
                .on("click", (event, d) => {
                    // NOTE: selectionId is not tied to a category due to table mapping.
                    // If you switch to 'categorical', wire a real identity here.
                    const multi = event.ctrlKey || event.metaKey;
                    this.selectionManager.select(d.selectionId!, multi);
                    event.stopPropagation();
                })
                .append("title")
                .text(d =>
                    `Risk: ${d.category}
                    Likelihood: ${d.likelihoodLabel}
                    Consequence: ${d.consequenceLabel}`
                ),
            update => update
                .attr("r", d => d.radius!)
                .attr("cx", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("cy", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0)),
            exit => exit.remove()
        );

        const nominalFontSize = Math.min(x.bandwidth(), y.bandwidth()) * 0.28;
        const labelFontSize = (this.formattingSettings as any)?.labels?.fontSize?.value ?? Math.max(10, Math.min(14, Math.floor(nominalFontSize)));
        const labelColor = (this.formattingSettings as any)?.labels?.color?.value ?? "#ffffff";
        const showLabels = (this.formattingSettings as any)?.labels?.show?.value ?? true;

        const labelsSel = this.labelsG
            .selectAll<SVGTextElement, Risk>("text.risk-label")
            .data(showLabels ? jitteredRisks : [], (d: any) => `${d.category}-${d.consequenceIdx}-${d.likelihoodIdx}`);

        labelsSel.join(
            enter => enter.append("text")
                .attr("class", "risk-label")
                .attr("text-anchor", "middle")
                .attr("fill", labelColor)
                .style("font-weight", "bold")
                .style("font-size", `${labelFontSize}px`)
                .attr("x", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("y", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0) + (labelFontSize * 0.35))
                .text(d => d.category),
            update => update
                .style("font-size", `${labelFontSize}px`)
                .attr("x", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("y", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0) + (labelFontSize * 0.35))
                .text(d => d.category),
            exit => exit.remove()
        );

    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

}
