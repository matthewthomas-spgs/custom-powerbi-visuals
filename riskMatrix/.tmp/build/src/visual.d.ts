import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
export declare class Visual implements IVisual {
    private target;
    private formattingSettingsService;
    private formattingSettings;
    private tooltipServiceWrapper;
    private tooltipValueCols;
    private tooltipCategoryCols;
    private _container;
    private margin_top;
    private margin_bottom;
    private margin_left;
    private margin_right;
    private riskConsequenceLevels;
    private riskLikelihoodLevels;
    private fallbackColourArray;
    private risks;
    private data;
    private host;
    private selectionManager;
    private colourPalette;
    private svg;
    private rootG;
    private axesG;
    private cellsG;
    private pointsG;
    private labelsG;
    private titleG;
    private xAxisTitleG;
    private yAxisTitleG;
    private getTooltipInfo;
    constructor(options: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    private clampIndex;
    private extractData;
    private consequenceLabelFromIndex;
    private likelihoodLabelFromIndex;
    private findCellColour;
    /**
     * Best‑fit rectangular grid: picks (cols, rows) that fit usable area and maximize the minimum pitch.
     */
    private calculateJitter;
    private renderChart;
    getFormattingModel(): powerbi.visuals.FormattingModel;
}
