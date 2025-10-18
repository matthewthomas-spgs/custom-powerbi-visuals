import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
export declare class Visual implements IVisual {
    private target;
    private formattingSettingsService;
    private formattingSettings;
    private _container;
    private margin_top;
    private margin_bottom;
    private margin_left;
    private margin_right;
    private width;
    private height;
    private riskConsequenceLevels;
    private riskLikelihoodLevels;
    private colourArray;
    private risks;
    private data;
    constructor(options: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    private extractData;
    private convertConsequenceValues;
    private convertLikelihoodValues;
    private renderChart;
    getFormattingModel(): powerbi.visuals.FormattingModel;
}
