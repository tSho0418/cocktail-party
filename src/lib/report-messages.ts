// Japanese labels and error text for the Report flow and the administrator screen (FR-070–076).
export const REPORT_REASON_LABELS = {
	inappropriate_photo: '不適切な画像',
	plagiarism: '他人の写真・レシピの盗用',
	spam: 'スパム',
	other: 'その他'
} as const;

export const REPORT_STATUS_LABELS = {
	open: '未対応',
	resolved: '対応済み',
	dismissed: '却下'
} as const;

export const ADMIN_ERRORS: Record<string, string> = {
	unauthorized: 'ログインが切れました。ログインし直してください。',
	suspended: 'このアカウントは利用を停止されています。',
	forbidden: 'この操作はできません。',
	not_found: '見つかりませんでした。',
	invalid_request: '入力内容を確認してください。',
	invalid_reason: '理由を選んでください。',
	detail_too_long: '自由記述は 200 字までです。',
	duplicate: 'すでに登録されています。',
	invalid_status: '状態が正しくありません。',
	self: '自分自身は停止できません。',
	invalid_name: '名前は 1〜50 字で入力してください。',
	invalid_abv: '度数は 0〜100 で、小数点以下1桁までにしてください(新規登録は 0 より大きい値)。',
	base_requires_alcohol: 'ベースの材料は 0% にできません。'
};

export const adminErrorMessage = (code: unknown) =>
	(typeof code === 'string' ? ADMIN_ERRORS[code] : undefined) ??
	'失敗しました。時間をおいてもう一度お試しください。';

// 'duplicate' reads as "name already taken" for an Ingredient; for a Report it means the Member already sent one (FR-071).
export const reportErrorMessage = (code: unknown) =>
	code === 'duplicate' ? 'このレシピはすでに通報しています。' : adminErrorMessage(code);
