# 無料枠だけで運用する(Vercel Hobby、Neon Free、Cloudflare R2)

運用費の上限が月500円(NFR-008)で、Cloudflare Workers Paid(最低 5 USD/月)、国内の VPS(1,265円/月から)、Supabase Pro(25 USD/月から)はすべて超える。そこで、サーバー側を無料枠だけで組み、Vercel Hobby、Neon Free(Postgres)、Cloudflare R2(画像)にした。

## Considered Options

- **Cloudflare 一式(Workers Free、D1、R2)**: 見送った。Workers Free の CPU 時間は 10ms で、SSR、認証、画像の再エンコードを載せると超える恐れがあった。Vercel の Node 関数なら、`sharp` がそのまま使える。
- **Vercel Hobby と Supabase Free**: 見送った。1週間アクセスがないとプロジェクトが停止し、再開を待つと NFR-001(2秒)を満たせない恐れがあった。

## Consequences

- Vercel Hobby は非商用・個人利用のみ。収益化(BG-003 で対象外)に踏み出すときは、Pro への移行が要る。
- Neon Free は、5分アクセスがないと停止し、再開に時間がかかる。実測して、NFR-001 に収まるかを確かめる(実装前の確認 S3)。
- Neon Free の復元履歴は6時間しかない。日次のバックアップは、自前の `pg_dump` で補う(NFR-003)。
- Vercel 関数が受け取れる本文は 4.5MB まで。画像の経路は、ADR 0003 に従う。
