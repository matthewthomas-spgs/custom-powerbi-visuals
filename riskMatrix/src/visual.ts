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


// Tunables (adjust to taste)
const RADIUS_FACTOR = 0.10; // % of min(cellW, cellH) used for circle radius
const GAP_FACTOR    = 0.3; // >= 0 : how much extra gap beyond diameter; 1.0 means 100% of radius as extra gap
const INNER_PAD_FR  = 2; // how much inner padding (in radii) to keep away from cell border (both sides)

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

    /**
     * Best‑fit rectangular grid: picks (cols, rows) that fit usable area and maximize the minimum pitch.
     */
    private calculateJitter(
    x: d3.ScaleBand<string>,
    y: d3.ScaleBand<string>,
    _width: number,
    _height: number
    ): Risk[] {
    const groups = d3.group(this.risks, d => `${d.consequenceIdx}-${d.likelihoodIdx}`);

    const cellW = Math.max(1, x.bandwidth());
    const cellH = Math.max(1, y.bandwidth());

    // Circle sizing
    const radius = Math.max(4, Math.min(cellW, cellH) * RADIUS_FACTOR);

    // Desired pitch between centers
    const gap    = Math.max(2, radius * GAP_FACTOR);
    const pitchX = (radius * 2) + gap;
    const pitchY = (radius * 2) + gap;

    // Inner padding, measured in radii, converted to px
    const innerPadX = Math.max(2, radius * INNER_PAD_FR);
    const innerPadY = Math.max(2, radius * INNER_PAD_FR);

    // Usable placement area
    const usableW = Math.max(0, cellW - innerPadX * 2);
    const usableH = Math.max(0, cellH - innerPadY * 2);

    function bestGrid(n: number) {
        // Upper bounds on how many we can fit at desired pitch
        const maxCols = Math.max(1, Math.floor(usableW / pitchX));
        const maxRows = Math.max(1, Math.floor(usableH / pitchY));
        const maxCap  = maxCols * maxRows;

        // If desired pitch is too big, we’ll still try to fit as many as possible by relaxing pitch a bit.
        // We’ll search feasible (cols,rows) where cols*rows >= n but cols<=ceil(usableW/(2r)), rows<=ceil(usableH/(2r))
        const hardCols = Math.max(1, Math.floor(usableW / (radius * 2))); // the absolute max if gap→0
        const hardRows = Math.max(1, Math.floor(usableH / (radius * 2)));

        // Search candidates around sqrt(n)
        const candidates: Array<{cols:number; rows:number; pitch:number}> = [];
        const maxColsTry = Math.max(1, Math.min(hardCols, Math.ceil(Math.sqrt(n)) + 6));
        for (let cols = 1; cols <= maxColsTry; cols++) {
        const rows = Math.max(1, Math.ceil(n / cols));
        if (rows > hardRows) continue;

        // Given cols/rows, compute the actual pitch we can afford to center the grid inside usable area
        // We want the min pitch across X/Y to be as large as possible (maximize separation).
        const actualPitchX = cols > 1 ? (usableW / (cols - 1)) : usableW; // single col → all at cx0
        const actualPitchY = rows > 1 ? (usableH / (rows - 1)) : usableH;

        // The pitch can't be less than 2*radius (or dots overlap). Skip impossible grids.
        if (actualPitchX < 2 * radius || actualPitchY < 2 * radius) continue;

        const minPitch = Math.min(actualPitchX, actualPitchY);
        candidates.push({ cols, rows, pitch: minPitch });
        }

        if (candidates.length === 0) {
        // Fallback: just pile them at center; later code will place them all at (0,0)
        return { cols: 1, rows: Math.max(1, n), pitchX: 2 * radius, pitchY: 2 * radius };
        }

        // Pick the grid that maximizes the minimum pitch
        candidates.sort((a, b) => b.pitch - a.pitch);
        const best = candidates[0];

        // Derive effective pitch (balanced) from usableW/H and best cols/rows
        const effPitchX = best.cols > 1 ? (usableW / (best.cols - 1)) : usableW;
        const effPitchY = best.rows > 1 ? (usableH / (best.rows - 1)) : usableH;

        return { cols: best.cols, rows: best.rows, pitchX: effPitchX, pitchY: effPitchY };
    }

    function positionsFor(n: number, cols: number, rows: number, effPitchX: number, effPitchY: number): [number, number][] {
        const gridW = (cols - 1) * effPitchX;
        const gridH = (rows - 1) * effPitchY;
        const cx0   = -gridW / 2;
        const cy0   = -gridH / 2;

        const pos: [number, number][] = [];
        for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols) % rows;
        const c = i % cols;
        pos.push([cx0 + c * effPitchX, cy0 + r * effPitchY]);
        }
        return pos;
    }

    const placed: Risk[] = [];

    for (const [key, group] of groups.entries()) {
        const [cIdxStr, lIdxStr] = key.split("-");
        const cIdx = Number(cIdxStr);
        const lIdx = Number(lIdxStr);
        const cLabel = this.consequenceLabelFromIndex(cIdx);
        const lLabel = this.likelihoodLabelFromIndex(lIdx);
        if (!cLabel || !lLabel) continue;

        const n = group.length;
        const best = bestGrid(n);
        const pos = positionsFor(n, best.cols, best.rows, best.pitchX, best.pitchY);

        for (let i = 0; i < n; i++) {
        const g = group[i];
        placed.push({
            ...g,
            consequenceLabel: cLabel,
            likelihoodLabel: lLabel,
            jitterX: pos[i][0],
            jitterY: pos[i][1],
            radius
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

        const pointColour = (this.formattingSettings as any)?.points?.color?.value ?? "#17457a";

        const points = this.pointsG
            .selectAll<SVGCircleElement, Risk>("circle.risk-point")
            .data(jitteredRisks, (d: any) => `${d.category}-${d.consequenceIdx}-${d.likelihoodIdx}`);

        points.join(
            enter => enter.append("circle")
                .attr("class", "risk-point")
                .attr("r", d => d.radius! + 8)
                .attr("cx", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("cy", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0))
                .attr("fill", pointColour)
                .attr("opacity", 0.9)
                .attr("stroke", "#24ae4b")
                .attr("stroke-width", "2")
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
