/**
 * WHAT CHANGED:
 * - Remove the module-scoped mutable `let data`.
 * - Return a fresh array each call (or export an immutable constant).
 * - Same shape and values as your original matrix.
 */

export interface MatrixCell {
    consequence: string;
    likelihood: string;
    colour: number; // 0..3 mapped to theme colors in visual.ts
    risk: string;   // "Low" | "Moderate" | "High" | "Extreme" (label only)
}

export type MatrixData = MatrixCell[];

// ORIGINAL (mutable):
// let data: MatrixData;
// export function create_base_matrix(): MatrixData {
//     data = [ ... ];
//     return data;
// }

// UPDATED (fresh array per call)
export function create_base_matrix(): MatrixData {
    return [
        { consequence: "Insignificant", likelihood: "Rare",             colour: 0, risk: "Low" },
        { consequence: "Insignificant", likelihood: "Unlikely",         colour: 0, risk: "Low" },
        { consequence: "Insignificant", likelihood: "Possible",         colour: 0, risk: "Low" },
        { consequence: "Insignificant", likelihood: "Likely",           colour: 0, risk: "Moderate" },
        { consequence: "Insignificant", likelihood: "Almost Certain",   colour: 1, risk: "High" },

        { consequence: "Minor",         likelihood: "Rare",             colour: 0, risk: "Low" },
        { consequence: "Minor",         likelihood: "Unlikely",         colour: 0, risk: "Low" },
        { consequence: "Minor",         likelihood: "Possible",         colour: 1, risk: "Moderate" },
        { consequence: "Minor",         likelihood: "Likely",           colour: 1, risk: "High" },
        { consequence: "Minor",         likelihood: "Almost Certain",   colour: 1, risk: "High" },

        { consequence: "Moderate",      likelihood: "Rare",             colour: 0, risk: "Low" },
        { consequence: "Moderate",      likelihood: "Unlikely",         colour: 1, risk: "Moderate" },
        { consequence: "Moderate",      likelihood: "Possible",         colour: 1, risk: "High" },
        { consequence: "Moderate",      likelihood: "Likely",           colour: 2, risk: "High" },
        { consequence: "Moderate",      likelihood: "Almost Certain",   colour: 2, risk: "Extreme" },

        { consequence: "Major",         likelihood: "Rare",             colour: 1, risk: "High" },
        { consequence: "Major",         likelihood: "Unlikely",         colour: 1, risk: "High" },
        { consequence: "Major",         likelihood: "Possible",         colour: 2, risk: "Extreme" },
        { consequence: "Major",         likelihood: "Likely",           colour: 3, risk: "Extreme" },
        { consequence: "Major",         likelihood: "Almost Certain",   colour: 3, risk: "Extreme" },

        { consequence: "Catastrophic",  likelihood: "Rare",             colour: 2, risk: "High" },
        { consequence: "Catastrophic",  likelihood: "Unlikely",         colour: 2, risk: "Extreme" },
        { consequence: "Catastrophic",  likelihood: "Possible",         colour: 3, risk: "Extreme" },
        { consequence: "Catastrophic",  likelihood: "Likely",           colour: 3, risk: "Extreme" },
        { consequence: "Catastrophic",  likelihood: "Almost Certain",   colour: 3, risk: "Extreme" }
    ];
}

// OPTIONAL: if you prefer a single immutable constant (and reuse the same reference)
// export const BASE_MATRIX: ReadonlyArray<MatrixCell> = Object.freeze(create_base_matrix());