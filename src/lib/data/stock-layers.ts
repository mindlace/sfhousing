// The stock-layer blend rule: "most permissive" is the layer with the larger full-fill yield.
export interface LayerTop {
  yieldTop: number;
  hostable: boolean;
}

/** 'b' iff b is hostable and (a is not, or b's full-fill yield is larger); a tie keeps 'a'. */
export function mostPermissive(a: LayerTop, b: LayerTop): 'a' | 'b' {
  return b.hostable && (!a.hostable || b.yieldTop > a.yieldTop) ? 'b' : 'a';
}
