export interface MatrixCell {
    consequence: string;
    likelihood: string;
    colour: number;
    risk: string;
}
export type MatrixData = MatrixCell[];
export declare function create_base_matrix(): MatrixData;
