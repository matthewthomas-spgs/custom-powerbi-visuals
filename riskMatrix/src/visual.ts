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
}

type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;

export class Visual implements IVisual {
    private target: HTMLElement;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;

    private _container: HTMLDivElement;

    private margin_top = 40;
    private margin_bottom = 40;
    private margin_left = 60;
    private margin_right = 40;

    private width = 1000;
    private height = 600;

    private riskConsequenceLevels = ["Insignificant","Minor","Moderate","Major","Catastrophic"];
    private riskLikelihoodLevels = ["Rare","Unlikely","Possible","Likely","Almost Certain"];

    private colourArray = ["#33CC33", "#FFCC00", "#FFA500", "#FF3333"];

    private risks: Risk[] = [];
    private data: MatrixData;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();

        this._container = document.createElement("div");
        this._container.style.position = "relative";
        this.target.appendChild(this._container);

        this.data = create_base_matrix();
    }

    public update(options: VisualUpdateOptions) {
        if (!options.dataViews || options.dataViews.length === 0) return;

        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews[0]
        );

        this.extractData(options.dataViews[0]);
        this.renderChart();
    }

    private extractData(dataView: DataView) {
        const table = dataView.table;
        if (!table || !table.rows || !table.columns) return;

        const labelIdx = table.columns.findIndex(c => c.roles["riskLabel"]);
        const consequenceIdx = table.columns.findIndex(c => c.roles["riskConsequenceRating"]);
        const likelihoodIdx = table.columns.findIndex(c => c.roles["riskLikelihoodRating"]);

        this.risks = table.rows.map(row => ({
            category: row[labelIdx]?.toString() ?? "N/A",
            consequenceIdx: Number(row[consequenceIdx]),
            likelihoodIdx: Number(row[likelihoodIdx])
        }));
    }

    private convertConsequenceValues(key: number): string {
        return this.riskConsequenceLevels[key - 1] ?? "Catastrophic";
    }

    private convertLikelihoodValues(key: number): string {
        return this.riskLikelihoodLevels[key - 1] ?? "Almost Certain";
    }

    private renderChart() {
        this._container.innerHTML = "";

        const svg = d3.select(this._container)
            .append("svg")
            .attr("width", this.width + this.margin_left + this.margin_right)
            .attr("height", this.height + this.margin_top + this.margin_bottom);

        // Title
        svg.append("text")
            .attr("x", (this.width + this.margin_left + this.margin_right)/2)
            .attr("y", this.margin_top / 2)
            .attr("text-anchor", "middle")
            .attr("font-size", "20px")
            .attr("font-weight", "bold")
            .text("Risk Matrix");

        const chart = svg.append("g")
            .attr("transform", `translate(${this.margin_left + 30}, ${this.margin_top})`);

        // Scales
        const x = d3.scaleBand<string>()
            .domain(this.riskConsequenceLevels)
            .range([0, this.width - 50])
            .padding(0.01);

        const y = d3.scaleBand<string>()
            .domain(this.riskLikelihoodLevels)
            .range([this.height, 0])
            .padding(0.01);

        // Axes
        chart.append("g")
            .attr("transform", `translate(0, ${this.height})`)
            .call(d3.axisBottom(x));

        chart.append("g")
            .call(d3.axisLeft(y));

        // Render base matrix
        chart.selectAll(".cell")
            .data(this.data)
            .join("rect")
            .attr("class", "cell")
            .attr("x", d => x(d.consequence)!)
            .attr("y", d => y(d.likelihood)!)
            .attr("width", x.bandwidth())
            .attr("height", y.bandwidth())
            .attr("fill", d => this.colourArray[d.colour])
            .attr("stroke", "#eee")
            .attr("stroke-width", 1);

        // Group points by cell for jitter
        const cellGroups: Map<string, Risk[]> = d3.group<Risk, string>(
            this.risks,
            d => `${d.consequenceIdx}-${d.likelihoodIdx}`
        ) as Map<string, Risk[]>;

        // Assign jitter within each cell
        const jitteredRisks = Array.from(cellGroups.values()).flatMap((group: Risk[]) => {
            const count = group.length;
            const radius = Math.min(15 + count * 3, 25); // increase spacing for more points
            const angleStep = (2 * Math.PI) / count;

            return group.map((risk, i) => {
                const angle = i * angleStep;
                return {
                    ...risk,
                    consequenceLabel: this.convertConsequenceValues(risk.consequenceIdx),
                    likelihoodLabel: this.convertLikelihoodValues(risk.likelihoodIdx),
                    jitterX: Math.cos(angle) * 2 * radius,
                    jitterY: Math.sin(angle) * 2 * radius
                };
            });
        });

        // Draw circles
        chart.selectAll(".risk-point")
            .data(jitteredRisks)
            .join("circle")
            .attr("class", "risk-point")
            .attr("cx", d => x(d.consequenceLabel)! + x.bandwidth()/2 + d.jitterX)
            .attr("cy", d => y(d.likelihoodLabel)! + y.bandwidth()/2 + d.jitterY)
            .attr("r", 20)
            .attr("fill", "blue")
            .attr("opacity", 0.9);

        // Draw labels
        chart.selectAll(".risk-label")
            .data(jitteredRisks)
            .join("text")
            .attr("class", "risk-label")
            .attr("x", d => x(d.consequenceLabel)! + x.bandwidth()/2 + d.jitterX)
            .attr("y", d => y(d.likelihoodLabel)! + y.bandwidth()/2 + d.jitterY + 5)
            .attr("text-anchor", "middle")
            .attr("fill", "white")
            .attr("font-size", "14px")
            .style("font-weight", "bold")
            .text(d => d.category);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
