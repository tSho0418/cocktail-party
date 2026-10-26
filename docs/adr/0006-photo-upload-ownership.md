# アップロードした Member を記録し、Recipe には自分の写真だけを使わせる

`mainPhotoKey` / `extraPhotoKeys` は、`POST /api/photos` が返す `recipe/<uuid>/{list,detail}.webp` を Recipe に書いたものだが、サーバーは鍵を誰がアップロードしたか知らなかった。存在しない鍵や、他の Member のまだ使われていないアップロードを、Recipe に指定できた。さらに、編集・削除後の掃除は、コミット後に別のクエリで参照を数えてから R2 を削除していたので、その間に別の Recipe が同じ鍵を使うと、消えた写真を指す Recipe ができた。

アップロードのたびに `photo_upload`(uuid、`member_id`、`kind`)に1行を記録する。Recipe の作成・編集は、次の条件を満たす鍵だけを受け付ける。

- 形が `recipe/<uuid>/list.webp` か `detail.webp` である。
- `<uuid>` の行が `photo_upload` にあり、`kind = 'recipe'` で、`member_id` が操作した Member である(編集では、その Recipe が既に使っている鍵はそのまま使える)。

Member アイコンも同じ検査をする。`updateProfile` は、`member/<uuid>/list.webp` の形で、`photo_upload` に `kind = 'member'`、`member_id` が本人の行がある鍵だけを受け付ける(今のアイコンの鍵はそのまま使える)。アイコンの差し替え・削除で参照されなくなったアップロードは、Recipe と同じく同じトランザクションで行を削除し、コミット後に R2 のオブジェクトを削除する。

編集・削除で Recipe に参照されなくなったアップロードは、同じトランザクションで `photo_upload` の行を削除する。R2 のオブジェクトの削除はコミットの後に行い、失敗してもリクエストは失敗させない。削除は `deleteObjects` に一本化し、呼び出し側(Recipe の編集・削除、`/admin` の Recipe 削除、アイコンの変更、掃除、退会)は参照を確かめ直さない。写真を参照できるのはアップロードした本人だけで、行を削除したトランザクションが参照の有無を確かめ済みか(解放)、本人ごと Recipe とアイコンが消えている(退会)ためである。失敗したキーは1つずつログに残す(行はもう無く、ログがオブジェクトの手がかりの唯一になる)。

ロックの順は、すべての書き込みで **Recipe の行 → `photo_upload` の行(id の昇順、`FOR UPDATE`)→ Ingredient の行 → Member の行** にそろえる(#40、#45)。Recipe の編集・削除は Recipe の行から、作成は Recipe の行がまだ無いので `photo_upload` の行から、アイコンの変更は `photo_upload` の行から Member の行へ、退会は Recipe の行、`photo_upload` の行、Member の行の順に取る。Recipe の作成・編集は、`photo_upload` の行のあとで、使う Ingredient の行を `FOR SHARE` で取る(度数の編集を待たせるため)。Ingredient の度数編集(FR-015)は、その Ingredient を使う Recipe の行(id の昇順)から、Ingredient の行の順に取る。Ingredient の行を取ったあとで Recipe を読み直し、間に Ingredient を使い始めた Recipe があれば、順を崩して取らず、書き込まずにトランザクションを終えて新しく始め直す(間にコミットされた編集の数だけ繰り返す。回数は同時に書き込む数で決まり、上限は設けない)。順がそろっているので、同じ Member の退会と Recipe の書き込み、Recipe の編集と Ingredient の度数編集が同時に走ってもデッドロックしない。参照の確認と書き込みは、写真の行をロックしてから行う。掃除(`sweepUnusedUploads`)は `photo_upload` の行だけを `SKIP LOCKED` でロックする。

## Considered Options

- **署名付きの鍵(HMAC)にして、アップロードした Member を鍵に埋め込む**: 見送った。「誰の」は確かめられるが、削除済みの鍵や未使用の鍵の再利用を止められず、掃除との競合も残る。鍵を保存して比べる必要もあり、結局行を持つほうが単純。
- **R2 に HEAD して存在だけ確かめる**: 見送った。他人の鍵を使えてしまい、リクエストごとにネットワークの呼び出しも増える。
- **コミット後に猶予期間を置いて削除する**: 見送った。競合の窓を狭めるだけで閉じられない。
- **使われなかったアップロードの掃除を、Vercel の cron(関数)にする**: 見送った。呼び出すための関数と認証が増える。GitHub Actions の定期実行でスクリプト(`pnpm photos:sweep`)を動かせば、関数は要らず、日次バックアップ(NFR-003)と同じ GitHub Actions に置ける。

## Consequences

- アップロードしたまま使われなかった写真(入力途中で離脱した、差し替えて保存しなかった、公開に失敗した)は、`created_at` から24時間を過ぎ、どの Recipe もアイコンも参照していなければ、`sweepUnusedUploads`(`pnpm photos:sweep`)が掃除する。行を `FOR UPDATE SKIP LOCKED` でロックして参照を確かめ直し、行を削除してから、コミット後に両方のオブジェクトを削除する。書き込み中の行は飛ばして、次の回に回す。実行は GitHub Actions の `sweep-photos.yml` で、`production` の secrets(`DATABASE_URL`、`R2_*`)がそろうまで手動実行(`main` からだけ。他のブランチから `production` の secrets に届かないようにする)だけにしてある。
- オブジェクトの削除はコミットの後なので、R2 が失敗すると行は消えたままオブジェクトだけが残る。掃除はそれを数え直さない。
- このマイグレーションより前に作られた Recipe の鍵は `photo_upload` に無い。`storePhoto` の形(`recipe/<uuid>/{list,detail}.webp`)の鍵なら、編集で今の鍵を送り直す限りそのまま使える。形が違う旧形式の鍵は、編集で `photo_key_invalid` として拒否される(公開前なのでバックフィルせず、該当するデータも無い見込み)。新しく足す鍵は検査される。
- Recipe の書き込みが、使う写真ごとに行ロックを取る。同じ写真を触る書き込みは直列になるが、1 Recipe の写真は最大4枚で、写真は Member 単位なので競合はまれ。
- 一つのアップロードを同じ Member の複数の Recipe に使える。最後の1件が参照しなくなった時点で解放される。
- 退会は、Recipe の写真やアイコンの鍵が `<kind>/<uuid>/{list,detail}.webp` の形なら、`photo_upload` に行が無くても list と detail の両方を返して削除する(#48)。形が違う鍵は、そのまま1本だけ返す。
