// The stock-layer blend rule: "most permissive" is the layer whose allowed options hold the most
// homes after its cap (rule A, envelope-row.ts `topHomesAt`).
export interface LayerTop {
  top: number;
  hostable: boolean;
}

/** 'b' iff b is hostable and (a is not, or b's most homes are more); a tie keeps 'a'. */
export function mostPermissive(a: LayerTop, b: LayerTop): 'a' | 'b' {
  return b.hostable && (!a.hostable || b.top > a.top) ? 'b' : 'a';
}
