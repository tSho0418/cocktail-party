# Cocktail Party

カクテルのレシピと写真を共有する日本語向け Web SNS。自宅で飲む人が再現できるレシピを探して投稿できる場であり、プロのバーテンダーも作品を発信できる。

## Language

**Recipe**:
カクテル1杯の作り方を共有する投稿の単位。Ingredient ごとの Mix Ratio・手順と、1枚の Main Photo を必ず持つ。常に1杯分を前提とする。
_Avoid_: Post, 投稿, entry

**Photo**:
Recipe に紐づく画像。Photo 単体の投稿は存在しない。1つの Recipe につき Main Photo 1枚(必須)と、追加の Photo 最大3枚(任意)を持てる。
_Avoid_: Image, picture, 画像

**Main Photo**:
完成したカクテルを写した Recipe の代表 Photo。一覧やプロフィールに表示される。
_Avoid_: Cover, thumbnail, 完成写真

**Ingredient**:
材料マスタに登録された材料。Recipe は Ingredient を選び、Mix Ratio を入力して使う。度数 0% の Ingredient は Member が新規登録でき、酒類の Ingredient は Administrator だけが登録する。
_Avoid_: Material, 材料名(自由入力テキスト)

**Mix Ratio**:
Recipe の中で、液体の Ingredient が混ぜる量全体に占める相対的な割合。小数も許す。分量の単位(ml や oz)は持たない。ミントの葉やビターズのような液量で表せない材料は Ingredient ではなく、手順の文章に書く。
_Avoid_: Amount, quantity, 分量

**Alcohol Content**:
Recipe の度数。Ingredient の度数と Mix Ratio から自動計算した目安の値で、氷の溶けは考慮しない。酒類の Ingredient を含む Recipe では、Member が上書きでき、上書きした値は自動計算の値と区別して表示する。上書きできる範囲は、0% を超え、含まれる Ingredient の最高度数以下。酒類を含まない Recipe は 0% に固定され、上書きできない。
_Avoid_: ABV, 度数(自由入力)

**Base**:
Recipe に含まれる、ベースになる酒の属性を持つ Ingredient。1つの Recipe が複数の Base を持つことがある。
_Avoid_: Main spirit, ベース酒

**Non-alcoholic**:
酒類の Ingredient を1つも含まない Recipe の状態。Alcohol Content の上書きには左右されない。Member が直接設定するフラグではない。
_Avoid_: ノンアルフラグ, mocktail

**Member**:
ログインして Recipe の投稿・Like・Save・Follow ができる利用者。非ログインの閲覧者は Member ではない。
_Avoid_: User, account, 会員

**Username**:
Member が登録時に自分で設定する公開名。メールアドレスは公開しない。
_Avoid_: Handle, display name

**Follow**:
Member が別の Member を購読する関係。
_Avoid_: Subscribe

**Like**:
Member が Recipe に付ける評価の印。
_Avoid_: Favorite, reaction

**Save**:
Member が後で作るために Recipe を自分用に取っておくこと。他の Member には見えない。
_Avoid_: Bookmark, favorite

**Report**:
Member が不適切な Recipe を管理者に知らせる操作。
_Avoid_: Flag

**Administrator**:
Report を確認し、Recipe の削除と Member の Suspension を行う権限を持つ Member。
_Avoid_: Admin user, moderator

**Suspension**:
Administrator が Member の利用を止める措置。
_Avoid_: Ban, block

**Age Gate**:
初回アクセス時に、閲覧者へ20歳以上であることを自己申告させる表示。同意は30日間 Cookie に保持する。本文は表示の裏でも読める。
_Avoid_: Age verification, 年齢確認
