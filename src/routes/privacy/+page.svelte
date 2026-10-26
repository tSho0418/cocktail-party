<script lang="ts">
	import { resolve } from '$app/paths';
	import { CONTACT, LEGAL_UPDATED, OPERATOR_NAME } from '#lib/legal.js';
</script>

<svelte:head>
	<title>プライバシーポリシー | Cocktail Party</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto max-w-2xl p-8 leading-relaxed">
	<h1 class="text-2xl font-bold">プライバシーポリシー</h1>
	<p class="mt-2 text-sm text-gray-600">制定: {LEGAL_UPDATED}</p>

	<p class="mt-6">
		{OPERATOR_NAME}(以下「運営者」)は、Cocktail
		Party(以下「本サービス」)で取り扱う情報について、次のとおり定めます。
	</p>

	<h2 class="mt-8 text-lg font-bold">1. 取得する情報</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			<strong>ログインの提供元(Google または LINE)が発行する、あなたを識別する ID</strong
			>と、提供元が発行するアクセストークン(有効期限などを含む)。ログインの管理に使います。
		</li>
		<li>
			<strong>メールアドレスは保存しません。</strong
			>LINE には、あなたを識別する ID だけを求め、メールアドレス、名前、プロフィール画像は求めません。Google がメールアドレス、名前、プロフィール画像の URL を返しても、本サービスは保存しません。
		</li>
		<li>
			<strong>ログインの記録</strong>: ログインしたときに、IP
			アドレスと、ブラウザの種類(User-Agent)を、セッションとともに保存します。セッション管理と、不正な利用への対応のためです。バックアップには含めません。
		</li>
		<li>
			<strong>ログインの回数の制限</strong>:
			ログインの開始と、提供元からの戻りの回数を数えて、短時間の連続した試行を断るために、IP
			アドレスをデータベースに保存します。1時間以上使われていない記録は、ログインの処理の中で順次削除します。バックアップには含めません。
		</li>
		<li>
			Member が自分で入力する情報:
			Username、自己紹介文、アイコン画像、Recipe(タイトル、説明、材料、手順、Photo)。Recipe、Username、自己紹介文、アイコン画像、Like
			の数、Follow している Member と Follower の一覧は、ログインしていない人にも見えます。Like
			を付けた Member は表示しません。Save の一覧は、本人にだけ見えます。
		</li>
		<li>Report の内容(通報した Member、対象の Recipe、理由)。運営者だけが確認します。</li>
		<li>
			サーバーの動作記録(アクセスした日時、URL、IP
			アドレスなど)。障害の調査と不正の防止のために、ホスティング事業者が記録します。
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">2. 利用目的</h2>
	<p class="mt-2">
		取得した情報は、ログインと Member の識別、Recipe
		の表示と検索、不正な利用や規約違反への対応、障害の調査、本サービスの改善のためだけに使います。広告のための利用や、第三者への販売はしません。
	</p>

	<h2 class="mt-8 text-lg font-bold">3. Cookie</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			<strong>セッション</strong>: ログインを保つために、ログインした Member
			のブラウザに保存します。ログアウトすると無効になります。
		</li>
		<li>
			<strong>Age Gate</strong>: 20歳以上であることを申告したことを覚えるために、30日間保存します。
		</li>
		<li>
			<strong>ログインの途中の確認用</strong>: Google や LINE
			でログインする間だけ使う、短時間で消える Cookie(OAuth の state)です。
		</li>
		<li>広告や、アクセスの追跡のための Cookie は使いません。</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">4. 写真の扱い</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			アップロードされた Photo
			は、位置情報などの撮影情報(EXIF)をすべて削除し、一覧用と詳細用の2つの大きさに変換して保存します。
		</li>
		<li>アップロードされた元のファイルは、保存しません。</li>
		<li>
			Photo は、Recipe のページを開く人には誰にでも見えます。Recipe、Photo、Member
			を削除しても、配信用のキャッシュに、最大で約1時間、残ることがあります。
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">5. 退会と削除</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			Member は、確認画面を経て、いつでも退会できます。猶予期間はありません。退会すると、その Member
			の Recipe、Photo、Like、Save、Follow をすべて削除します。
		</li>
		<li>
			削除は、本サービスのデータベースと、Photo
			の保存先に対して行います。下記のバックアップには、最大14日間、残ることがあります。
		</li>
		<li>
			LINE でログインした Member が退会すると、削除の後に、LINE のアクセストークンを使って、LINE(LY
			Corporation)に退会したことを通知し、本サービスと LINE アプリの連携を解除します。LINE
			での認証(ログイン画面から LINE
			に進む操作)を最後に行ってから90日以上たっているなどでトークンが使えないとき、または LINE
			へ接続できないときは、解除できません。その場合も退会は完了し、削除したデータは元に戻りません。連携は、LINE
			アプリの「設定 &gt; アカウント &gt; 連携アプリ」から解除できます。
		</li>
		<li>
			Google でログインした Member が退会すると、削除の後に、保存している Google
			のアクセストークンを、Google
			に失効させます。トークンの有効期限(約1時間)が切れているとき、または Google
			へ接続できないときは、失効させません。その場合も退会は完了します。
		</li>
		<li>
			Report の理由と補足は、運営者の記録として残します。Member を退会しても、その Member と Report
			の結びつきが外れるだけで、Report 自体は残ります。削除した Recipe の内容は、Report
			に残しません。
		</li>
		<li>Recipe を自分で削除したときも、その Recipe の Like と Save は削除します。</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">6. バックアップ</h2>
	<p class="mt-2">
		障害に備えて、データベースを定期的にバックアップし、14日分を保存します。バックアップは運営者だけが扱い、公開しない保存先に置き、古いものから自動で削除します。ログインの記録(IP
		アドレス、User-Agent)、ログインの回数の制限のための記録(IP
		アドレス)、ログインの途中の確認用の情報は、バックアップに含めません。
	</p>

	<h2 class="mt-8 text-lg font-bold">7. 外部サービスへの委託と第三者への提供</h2>
	<p class="mt-2">本サービスは、次の外部サービスを使っています。</p>
	<ul class="mt-2 list-disc pl-6">
		<li>Google(ログイン)</li>
		<li>LINE(ログイン)</li>
		<li>Cloudflare R2(Photo とバックアップの保存)</li>
		<li>GitHub(バックアップを作る処理の実行。作成中のデータが一時的に通ります)</li>
		<li>Vercel(Web サイトの提供)</li>
		<li>Neon(データベース)</li>
	</ul>
	<p class="mt-2">
		各サービスは、本サービスの提供に必要な範囲で情報を扱い、一部は日本国外のサーバーで処理します。ログインでは、利用者が選んだ提供元の利用規約とプライバシーポリシーも適用されます。
		法令に基づく場合を除き、これら以外の第三者へ、個人に関する情報を提供しません。
	</p>

	<h2 class="mt-8 text-lg font-bold">8. 開示、訂正、削除の請求</h2>
	<p class="mt-2">
		Username、自己紹介文、アイコン画像は、Member
		が自分で変更でき、退会で削除できます。それ以外に、保有する自分の情報の開示や削除を求めるときは、{CONTACT}へ連絡してください。
	</p>

	<h2 class="mt-8 text-lg font-bold">9. 変更</h2>
	<p class="mt-2">この内容は、必要に応じて変更します。変更したときは、このページに掲載します。</p>

	<h2 class="mt-8 text-lg font-bold">10. 問い合わせ</h2>
	<p class="mt-2">{OPERATOR_NAME}: {CONTACT}</p>

	<p class="mt-8 text-sm"><a class="underline" href={resolve('/terms')}>利用規約</a></p>
</main>
