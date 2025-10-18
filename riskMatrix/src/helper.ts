export interface MatrixCell {
    consequence: string;
    likelihood: string;
    colour: number;
    risk: string;

}

export type MatrixData = MatrixCell[];

let data: MatrixData;

export function create_base_matrix(): MatrixData {
    

    data = [
        { consequence: "Insignificant", likelihood: "Rare", colour: 0, risk: "Low" },
        { consequence: "Insignificant", likelihood: "Unlikely", colour: 0, risk: "Low" },
        { consequence: "Insignificant", likelihood: "Possible", colour: 0, risk: "Low" },
        { consequence: "Insignificant", likelihood: "Likely", colour: 0, risk: "Moderate" },
        { consequence: "Insignificant", likelihood: "Almost Certain", colour: 1, risk: "High" },
        { consequence: "Minor", likelihood: "Rare", colour: 0, risk: "Low" },
        { consequence: "Minor", likelihood: "Unlikely", colour: 0, risk: "Low" },
        { consequence: "Minor", likelihood: "Possible", colour: 1, risk: "Moderate" },
        { consequence: "Minor", likelihood: "Likely", colour: 1, risk: "High" },
        { consequence: "Minor", likelihood: "Almost Certain", colour: 1, risk: "High" },
        { consequence: "Moderate", likelihood: "Rare", colour: 0, risk: "Low" },
        { consequence: "Moderate", likelihood: "Unlikely", colour: 1, risk: "Moderate" },
        { consequence: "Moderate", likelihood: "Possible", colour: 1, risk: "High" },
        { consequence: "Moderate", likelihood: "Likely", colour: 2, risk: "High" },
        { consequence: "Moderate", likelihood: "Almost Certain", colour: 2, risk: "Extreme" },
        { consequence: "Major", likelihood: "Rare", colour: 1, risk: "High" },
        { consequence: "Major", likelihood: "Unlikely", colour: 1, risk: "High" },
        { consequence: "Major", likelihood: "Possible", colour: 2, risk: "Extreme" },
        { consequence: "Major", likelihood: "Likely", colour: 3, risk: "Extreme" },
        { consequence: "Major", likelihood: "Almost Certain", colour: 3, risk: "Extreme" },
        { consequence: "Catastrophic", likelihood: "Rare", colour: 2, risk: "High" },
        { consequence: "Catastrophic", likelihood: "Unlikely", colour: 2, risk: "Extreme" },
        { consequence: "Catastrophic", likelihood: "Possible", colour: 3, risk: "Extreme" },
        { consequence: "Catastrophic", likelihood: "Likely", colour: 3, risk: "Extreme" },
        { consequence: "Catastrophic", likelihood: "Almost Certain", colour: 3, risk: "Extreme" }
    ]

    return data;
}