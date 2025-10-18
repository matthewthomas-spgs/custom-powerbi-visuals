/*
*  Power BI Visual CLI
*
*  Copyright (c) Microsoft Corporation
*  All rights reserved.
*  MIT License
*
*  Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the ""Software""), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
*
*  The above copyright notice and this permission notice shall be included in
*  all copies or substantial portions of the Software.
*
*  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import * as d3 from "d3";
import { create_base_matrix  } from "./helper";
import type { MatrixCell, MatrixData } from "./helper";

interface Risk {
    category: string,
    consequenceIdx: number,
    likelihoodIdx: number
}

interface Risks {
    items: Risk[]
}

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import DataView = powerbi.DataView;
import IVisualHost = powerbi.extensibility.IVisualHost;

import { VisualFormattingSettingsModel } from "./settings";

type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;

export class Visual implements IVisual {
    private target: HTMLElement;
    private updateCount: number;
    private textNode: Text;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private host: IVisualHost;
    private svg: Selection<SVGElement>;
    private circle: Selection<SVGElement>;
    private _container: Selection<SVGElement>;

    /* define control properties */
    private margin_top: number;
    private margin_bottom: number;
    private margin_left: number;
    private margin_right: number;
    private width: number;
    private height: number;

    private riskConsequenceLevels: string[];
    private riskLikelihoodLevels: string[];
    private colourArray: string[];
    private data: MatrixData;
    private risks: Risk[] = [];

    // Helper: compute consistent jitter per risk
    private jitterOffset(label: string): { dx: number, dy: number } {
        // Create a simple deterministic jitter based on label hash
        const hash = Array.from(label)
            .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const rand = (n: number) => ((hash % n) / n) - 0.5;
        return {
            dx: rand(10) * 100, // up to ±5 px horizontally
            dy: rand(7) * 50   // up to ±5 px vertically
        };
    }

    private convertConsequenceValues(key: number): string {
        switch(key) {
            case 1:
                return "Insignificant";
            case 2:
                return "Minor";
            case 3:
                return "Moderate";
            case 4:
                return "Major";
            default:
                return "Catastrophic";
        }
    }

    private convertLikelihoodValues(key: number): string {
        switch(key) {
            case 1:
                return "Rare";
            case 2:
                return "Unlikely";
            case 3:
                return "Possible";
            case 4:
                return "Likely";
            default:
                return "Almost Certain";
        }
    }

    private getOptionSetConsequenceValue(value: any): number {
        if (typeof value === "number") return value;
        if (typeof value === "string") {
            const v = value.trim().toLowerCase();
            switch (v) {
                case "insignificant": return 1;
                case "minor": return 2;
                case "moderate": return 3;
                case "major": return 4;
                case "catastrophic": return 5;
                default:
                    const num = parseInt(v);
                    return isNaN(num) ? 5 : num;
            }
        }
        return 5;
    }

    private getOptionSetLikelihoodValue(value: any): number {
        if (typeof value === "number") return value;
        if (typeof value === "string") {
            const v = value.trim().toLowerCase();
            switch (v) {
                case "rare": return 1;
                case "unlikely": return 2;
                case "possible": return 3;
                case "likely": return 4;
                case "almost certain": return 5;
                default:
                    const num = parseInt(v);
                    return isNaN(num) ? 5 : num;
            }
        }
        return 5;
    }


    private extractData(dataView: DataView): Risk[] {

        const table = dataView.table;

        if (!table || !table.rows || !table.columns) {
            console.warn("problem with data table\n");
            return [];

        }

        const label_idx = table.columns.findIndex(col => col.roles["riskLabel"]);
        const consequence_idx = table.columns.findIndex(col => col.roles["riskConsequenceRating"]);
        const likelihood_idx = table.columns.findIndex(col => col.roles["riskLikelihoodRating"]);

        const risks: Risk[] = [];
        
        table.rows.forEach((row, i) => {

            const label = String(row[label_idx]);
            const consequence = this.getOptionSetConsequenceValue(row[consequence_idx]);
            const likelihood = this.getOptionSetLikelihoodValue(row[likelihood_idx]);

            //console.log(`Row ${i + 1}: Label = ${label}, Consequence = ${consequence}, "Likelihood = ${likelihood}`);

            risks.push({
                category: label,
                consequenceIdx: consequence,
                likelihoodIdx: likelihood
            });
        });

        console.log("Extracted Risks: ", risks);
        return risks;
        
    }

    /* render chart function helpder */
    private renderChart(): void {

        console.log("renderChart start");

        try {
            this._container.innerHTML = "";

            const calcWidth = 1000;
            const calcHeight = 600;

            const width = Math.max(calcWidth, 500);
            const height = Math.max(calcHeight, 500);

            const cellGroups: Map<string, Risk[]> = d3.group(this.risks, d => 
                `${d.consequenceIdx}-${d.likelihoodIdx}`
            );

            // assign jitter offsets within each cell
            const jitteredRisks = Array.from(cellGroups.values()).flatMap(group => {
                        const count = group.length;
                        const angleStep = (2 * Math.PI) / count;
                        const radius = Math.min(4 + count, 10); // spread increases with count

                        return group.map((risk, i) => {
                            const angle = i * angleStep;
                            return {
                                ...risk,
                                consequenceLabel: this.convertConsequenceValues(risk.consequenceIdx),
                                likelihoodLabel: this.convertLikelihoodValues(risk.likelihoodIdx),
                                jitterX: Math.cos(angle) * radius,
                                jitterY: Math.sin(angle) * radius
                            };
                        });
            });


            const svg = d3.select(this._container)
                .append("svg")
                .attr("width", width + this.margin_left + this.margin_right)
                .attr("height", height + this.margin_top + this.margin_bottom)

            /* add a chart title */
            svg.append("text")
                .attr("x", (width + this.margin_left + this.margin_right) / 2)
                .attr("y", this.margin_top / 2)
                .attr("text-anchor", "middle")
                .attr("font-size", "16px")
                .attr("font-weight", "bold")
                .text(`Risk Matrix`);

            const chart_container = svg
                .append("g")
                .attr("transform", `translate(${this.margin_left + 50}, ${this.margin_top})`);

            /* build x scale and axis */
            const x = d3.scaleBand<string>()
                .range([0, width - 50])
                .domain(this.riskConsequenceLevels)
                //.domain(d3.range(this.numConsequenceLevels))
                .padding(0.01);

            chart_container.append("g")
                .attr("transform", `translate(0, ${height})`)
                .call(d3.axisBottom(x));

            /* build y scale and axis */
            const y = d3.scaleBand<string>()
                .range([height, 0])
                .domain(this.riskLikelihoodLevels)
                //.domain(d3.range(this.numLikelihoodLevels))
                .padding(0.01);

            chart_container.append("g")
                .call(d3.axisLeft(y));

            chart_container.selectAll<SVGRectElement, MatrixCell>(".cell")
                .data(this.data)
                .join("rect")
                .attr("class", "cell")
                .attr("x", d => {
                    //console.log("x: ", d.consequence, x(d.consequence));
                    return x(d.consequence)!;
                })
                .attr("y", d => {
                    //console.log("y: ", d.likelihood, y(d.likelihood));
                    return y(d.likelihood)!;
                })
                .attr("width", x.bandwidth())
                .attr("height", y.bandwidth())
                .attr("fill", d => this.colourArray[d.colour]);

            chart_container.selectAll(".risk-point")
                .data(this.risks)
                .join("circle")
                .attr("class", "risk-point")
                .attr("cx", d => {
                    const baseX = x(this.convertConsequenceValues(d.consequenceIdx))! + x.bandwidth() / 2;
                    return baseX + d.jitterX;
                })
                .attr("cy", d => {
                    const baseY = y(this.convertLikelihoodValues(d.likelihoodIdx))! + y.bandwidth() / 2;
                    return baseY + d.jitterY;
                })
                .attr("r", 25)
                .attr("fill", "blue")
                .attr("opacity", 0.7);

            chart_container.selectAll(".risk-label")
                .data(this.risks)
                .join("text")
                .attr("class", "risk-label")
                .attr("x", d => x(this.convertConsequenceValues(d.consequenceIdx))! + x.bandwidth() / 2 + d.jitterX)
                .attr("y", d => y(this.convertLikelihoodValues(d.likelihoodIdx))! + y.bandwidth() / 2 + d.jitterY + 3)
                .attr("text-anchor", "middle")
                .attr("fill", "white")
                .attr("font-size", "12px")
                .style("pointer-events", "none")
                .text(d => d.category); // short label
                                

        } catch(error) {
            console.error("error in renderChart: ", error);
        }
            
    }

    constructor(options: VisualConstructorOptions) {
        console.log('Visual constructor', options);
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.updateCount = 0;
        if (document) {
            /*
            const new_p: HTMLElement = document.createElement("p");
            new_p.appendChild(document.createTextNode("Update count:"));
            const new_em: HTMLElement = document.createElement("em");
            this.textNode = document.createTextNode(this.updateCount.toString());
            new_em.appendChild(this.textNode);
            new_p.appendChild(new_em);
            this.target.appendChild(new_p);
            */

            /* Add control initialization code */
            this._container = document.createElement("div");
            this._container.style.position = "relative";

            /* initialise graph attributes */
            this.margin_bottom = 30;
            this.margin_left = 30;
            this.margin_right = 30;
            this.margin_top = 30;

            this.data = create_base_matrix();

            this.colourArray = ["#33CC33", "#FFCC00", "#FFA500", "#FF3333"];

            this.riskConsequenceLevels = [
                "Insignificant",
                "Minor",
                "Moderate",
                "Major",
                "Catastrophic"
            ];

            this.riskLikelihoodLevels = [
                "Rare",
                "Unlikely",
                "Possible",
                "Likely",
                "Almost Certain"
            ];

            this.renderChart();
           
            this.target.appendChild(this._container as unknown as Node);
        }
    }

    public update(options: VisualUpdateOptions) {
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews[0]);
        
        if (options.dataViews.length > 0) {
            this.risks = this.extractData(options.dataViews[0]);
            this.renderChart();
        }
    }

    /**
     * Returns properties pane formatting model content hierarchies, properties and latest formatting values, Then populate properties pane.
     * This method is called once every time we open properties pane or when the user edit any format property. 
     */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        //return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
        /*
        const recordIdToUse = this.selectedRecordId || dataset.sortedRecordIds[0];
        const currentRecord = dataset.records[recordIdToUse];

        if (currentRecord) {
            const rawLikelihood = currentRecord.getValue("pgrowth_risklikelihood");
            const rawConsequence = currentRecord.getValue("pgrowth_riskconsequence");
            const recordTitle = currentRecord.getValue("pgrowth_name") as string ?? "";    

            const consequenceValue = Number(rawConsequence);
            const likelihoodValue = Number(rawLikelihood);

            this.thisRecordConsequence = this.convertConsequenceValues(consequenceValue);
            this.thisRecordLikelihood = this.convertLikelihoodValues(likelihoodValue);
            this.thisRecordTitle = recordTitle;
            this.thisRecordId = recordIdToUse;

            this.selectedRecordId = null;
        } 
            */

        this.renderChart();

        return;
    }
}