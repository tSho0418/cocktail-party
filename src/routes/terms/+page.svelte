<script lang="ts">
	import { resolve } from '$app/paths';
	import { CONTACT, LEGAL_UPDATED, OPERATOR_NAME } from '#lib/legal.js';
</script>

<svelte:head>
	<title>利用規約 | Cocktail Party</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto max-w-2xl p-8 leading-relaxed">
	<h1 class="text-2xl font-bold">利用規約</h1>
	<p class="mt-2 text-sm text-gray-600">制定: {LEGAL_UPDATED}</p>

	<p class="mt-6">
		この利用規約(以下「本規約」)は、{OPERATOR_NAME}(以下「運営者」)が提供する Cocktail Party
		(以下「本サービス」)の利用条件を定めるものです。本サービスを利用した時点で、本規約に同意したものとみなします。
	</p>

	<h2 class="mt-8 text-lg font-bold">1. 本サービスについて</h2>
	<p class="mt-2">
		本サービスは、カクテルの Recipe と Photo を共有する Web サイトです。Recipe
		の閲覧には登録は要りません。投稿、Like、Save、Follow などは、Google または LINE でログインした
		Member だけが行えます。
	</p>

	<h2 class="mt-8 text-lg font-bold">2. 利用できる人</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>本サービスは、20歳以上の方だけが利用できます。20歳未満の方は、利用できません。</li>
		<li>
			初めて訪れたときに、20歳以上であることの確認を求めます。この確認は申告であり、運営者が年齢を証明する書類などで確かめることはありません。
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">3. アカウント</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			ログインは、Google と LINE のアカウントによります。メールアドレスとパスワードは使いません。
		</li>
		<li>
			1つの Member は、1つのログイン提供元に対応します。提供元を変えると、別の Member になります。
		</li>
		<li>ログインに使うアカウントの管理は、利用者の責任で行ってください。</li>
		<li>
			Member は、いつでも退会できます。退会すると、その Member の Recipe、Photo、Like、Save、Follow
			をすべて削除します。猶予期間はなく、削除したものは元に戻せません。
		</li>
		<li>
			LINE でログインした Member が退会すると、LY
			Corporation(LINE)に退会したことが通知され、本サービスと LINE アプリの連携が解除されます。
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">4. 投稿の権利と写真の扱い</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			<strong>他人が撮影・作成した写真や画像を、その人の許可なく投稿してはいけません。</strong
			>投稿できるのは、自分で撮影した Photo、または掲載の許可を得た Photo だけです。
		</li>
		<li>
			書籍、Web サイト、他の SNS、店のメニューなどに載っている Recipe
			の文章や写真を、そのまま転載してはいけません。
		</li>
		<li>
			投稿した Recipe と Photo
			の権利は、投稿者に残ります。投稿者は、本サービスの運営と表示に必要な範囲で、運営者が投稿を保存、変換(サイズの変更と形式の変換を含みます)、表示することを許可するものとします。
		</li>
		<li>
			投稿した Photo
			は、位置情報などの撮影情報(EXIF)を削除し、大きさを変えて保存します。元のファイルは保存しません。
		</li>
		<li>
			権利を侵害された方は、{CONTACT}へ連絡してください。内容を確認し、必要と判断したときは、投稿を削除します。
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">5. 禁止事項</h2>
	<p class="mt-2">次のことを禁止します。</p>
	<ul class="mt-2 list-disc pl-6">
		<li>前条に反する、他人の写真や文章の無断掲載</li>
		<li>法令または公序良俗に反する投稿</li>
		<li>他の Member や第三者への誹謗中傷、嫌がらせ、なりすまし</li>
		<li>20歳未満の人への飲酒の勧めや、過度な飲酒、一気飲みなど、健康を損なう飲み方をあおる投稿</li>
		<li>
			Recipe と関係のない宣伝、勧誘、スパム、同じ内容の繰り返しの投稿、Like や Follow の不正な操作
		</li>
		<li>本サービスの運営を妨げる行為、不正アクセス、他の Member の個人情報の収集</li>
		<li>その他、運営者が不適切と判断する行為</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">6. 通報、削除、利用の停止</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>Member は、本規約に反すると考える Recipe を、Report で運営者に知らせることができます。</li>
		<li>
			運営者の Administrator は、Report の内容や本規約に反する投稿を確認したとき、その Recipe
			を、事前の通知なく削除することがあります。
		</li>
		<li>
			本規約に反した Member に対して、Administrator
			は、利用を停止(Suspension)することがあります。停止された Member はログインできず、その Recipe
			は表示されなくなります。
		</li>
		<li>
			削除や停止の判断の理由を、個別にお知らせする義務は負いません。ただし、{CONTACT}へ問い合わせることはできます。
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">7. 免責</h2>
	<ul class="mt-2 list-disc pl-6">
		<li>
			Recipe
			と、表示するアルコール度数は、投稿者の入力と材料の標準的な度数から求めた目安です。正確さ、安全性、味、体質への適合を保証しません。
		</li>
		<li>
			飲酒は、ご自身の判断と責任で、適量を守って行ってください。飲酒運転は法律で禁止されています。妊娠中や授乳中の飲酒、持病のある方の飲酒には、特に注意してください。
		</li>
		<li>投稿は Member によるものです。運営者は、その内容の正確さや適法性を保証しません。</li>
		<li>
			運営者は、本サービスの中断、停止、変更、障害、データの消失によって利用者に生じた損害について、運営者に故意または重大な過失がある場合を除き、責任を負いません。
		</li>
		<li>Member 同士、または Member と第三者の間の紛争は、当事者の間で解決してください。</li>
	</ul>

	<h2 class="mt-8 text-lg font-bold">8. サービスの変更と終了</h2>
	<p class="mt-2">
		運営者は、事前の通知なく、本サービスの内容を変更し、または提供を終了することがあります。
	</p>

	<h2 class="mt-8 text-lg font-bold">9. 本規約の変更</h2>
	<p class="mt-2">
		運営者は、必要に応じて本規約を変更できます。変更後の本規約は、このページに掲載した時点から効力を生じ、その後に本サービスを利用した場合は、変更に同意したものとみなします。
	</p>

	<h2 class="mt-8 text-lg font-bold">10. 準拠法と裁判所</h2>
	<p class="mt-2">
		本規約は日本法に従って解釈します。本サービスに関して紛争が生じたときは、運営者の所在地を管轄する日本の裁判所を第一審の専属的合意管轄とします。
	</p>

	<h2 class="mt-8 text-lg font-bold">11. 問い合わせ</h2>
	<p class="mt-2">本サービスに関する問い合わせは、{CONTACT}へお願いします。</p>

	<p class="mt-8 text-sm">
		<a class="underline" href={resolve('/privacy')}>プライバシーポリシー</a>
	</p>
</main>
