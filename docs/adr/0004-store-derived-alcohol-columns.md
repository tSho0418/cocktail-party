# 度数と「酒類を含むか」を Recipe の列として保存する

Recipe に、自動計算の度数と、酒類の Ingredient を含むかどうかを列として保存し、Recipe の保存時と、Ingredient の度数編集時(FR-015)に、同じトランザクションで再計算する。度数の範囲の絞り込み(FR-044)や Non-alcoholic の判定(FR-025)を、一覧の検索のたびに全件の集計にしないためである。Base は、検索のときに Ingredient を結合して導出する。

## Considered Options

- **保存せず、検索のたびに SQL の集計で計算する**: 見送った。一貫性の心配はないが、検索ごとに全件を集計する。Neon Free は、計算時間が月100 CU 時間に限られ、停止後の再開も遅い。

## Consequences

- 導出した列と、元の Ingredient の度数・Mix Ratio が食い違う可能性がある。再計算を、必ず同じトランザクションで行い、途中で失敗しても食い違いを残さない。
- Ingredient の度数を編集すると、その Ingredient を使うすべての Recipe を再計算する。上書きが範囲外になった Recipe は、同じ処理で破棄して自動計算の値に戻す(FR-015)。
