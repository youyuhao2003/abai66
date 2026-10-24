// 端点总注册表:合并所有模块,并校验覆盖度
import { cardActions, chatActions, knowledgeActions } from './actions_part1.mjs';
import {
  imageActions, payActions, taskActions, socialActions,
  bountyActions, commissionActions, noticeActions, ticketActions,
} from './actions_part2.mjs';
import { miniappActions, settingsActions } from './actions_part3.mjs';
import { engineActions } from './engine_actions.mjs';
import { cardDetailActions } from './card_detail.mjs';
import { userActions } from './user_actions.mjs';
import { q } from './db.mysql.mjs';

// 补:额度流水
const creditActions = {
  'list-credit-history': async ({ user }, body) => {
    const rows = await q(
      `SELECT id, type, amount, balance, note, created_at AS at
       FROM credit_history WHERE user_id=? ORDER BY id DESC LIMIT ?`,
      [user.id, Math.min(100, Number(body.limit) || 30)]);
    return { success: true, items: rows.map(r => ({ ...r, at: Number(r.at) })) };
  },
};

const chatDuplicate = {
  'create-chat-completion': chatActions['create-chat-completion'],
};

export const actions = {
  ...cardActions,
  ...chatActions,
  ...knowledgeActions,
  ...imageActions,
  ...payActions,
  ...taskActions,
  ...socialActions,
  ...bountyActions,
  ...commissionActions,
  ...noticeActions,
  ...ticketActions,
  ...miniappActions,
  ...settingsActions,
  ...engineActions,
  ...cardDetailActions,
  ...userActions,
  ...creditActions,
};

// 需要登录才能访问
export const PUBLIC_ACTIONS = new Set([
  'list-public-character-cards',
  'get-public-character-card',
  'search-character-cards',
  'get-leaderboard',
  'list-recharge-packages',
  'get-model-options',
  'list-model-options',
  'list-text-to-image-engines',
  'get-announcements',
  'list-public-world-books',
  'get-public-world-book',
  'list-top-authors',
  'get-author-stats',
  'list-gallery-images',
  'list-character-images',
  'get-top-queries',
  'get-character-share-link',
  'list-active-bounties',
  'list-bounty-claims',
  'get-consumer-status',
  'get-bot-reachability',
  'list-character-card-tier-up',
  'list-character-tips',
  'list-reviews',
  'get-like-stats',
  'get-public-user-profile',
  'list-redeem-codes',
]);

// 端点清单(用于覆盖度自检)
export const ORIGIN_ACTIONS = [
  'upsert-character-card','migrate-character-card','import-character-card-png','list-my-character-cards',
  'list-public-character-cards','get-character-card','get-public-character-card','create-chat-completion',
  'undo-last-round','refresh-greeting','save-user-message','get-archive','list-archives','get-archive-messages',
  'create-archive','update-archive','import-chat-history','upload-image','list-user-images','gen-image-for-message',
  'list-character-images','list-user-generated-images','review-image','list-gallery-images','gen-options-for-message',
  'gen-status-bar-for-message','gen-knowledge-from-messages','get-knowledge','update-knowledge-entries',
  'gen-character-card','list-workshop-character-cards','gen-miniapp','get-miniapp-gen-task','get-miniapp-gen-spec',
  'review-character-card','gen-card-review','get-card-review','list-top-authors','get-author-stats',
  'search-character-cards','get-character-card-i18n','upsert-world-book','get-world-book','list-my-world-books',
  'list-public-world-books','get-public-world-book','review-world-book','extract-world-book','get-character-miniapp',
  'stream-miniapp-completion','miniapp-draw-generate','miniapp-kv-get','miniapp-kv-put','miniapp-kv-delete',
  'miniapp-chat-insert','miniapp-chat-list','miniapp-chat-timeline','gamefy-bundle-begin','gamefy-bundle-put',
  'gamefy-bundle-finish','scan-miniapp','create-payment-link','get-order-status','track-payment-link-opened',
  'list-order-history','list-recharge-packages','create-checkin','get-checkin-credits','get-checkin-daily-summary',
  'get-user-profile','get-public-user-profile','get-account-balance','update-user-profile','bind-account',
  'get-user-preferences','update-user-preferences','get-model-settings','update-model-settings','get-model-options',
  'calculate-model-price','calculate-image-price','calculate-plot-options-price','get-top-queries',
  'list-credit-history','upsert-review','list-reviews','get-like-stats','toggle-like','toggle-favorite',
  'list-user-collections','delete-review','toggle-pin-review','redeem-code','create-redeem-code','list-redeem-codes',
  'report-tg-start-param','report-write-access','get-bot-reachability','get-user-tasks','claim-task-reward',
  'repair-chat-streak','claim-streak-milestone','claim-streak-cycle','get-character-reward-progress',
  'claim-character-reward','list-character-card-tier-up','claim-character-card-tier-up','send-character-tip',
  'list-character-tips','unlock-character-gallery','create-character-bounty','reserve-bounty-slot',
  'claim-bounty-reward','abandon-bounty-claim','list-active-bounties','list-my-active-bounty-claims',
  'get-bounty-claim-progress','list-bounty-claims','mark-bounty-low-quality','toggle-follow','list-user-follows',
  'get-leaderboard','submit-report','publish-character-card','get-publish-log','get-character-card-studio-editable',
  'get-character-share-link','init-knowledge','get-notifications','save-announcement','get-announcements',
  'delete-announcement','get-ambassador-dashboard','get-invite-code-stats','get-daily-invite-stats',
  'get-daily-rebate-stats','bind-invite-code','get-commission-records','redeem-commission','withdraw-commission',
  'miniapp-completions','miniapp-models-list','miniapp-user-info','miniapp-draw-generate','miniapp-launch-check',
  'generate-image','get-generation-task','calculate-generation-price','list-text-to-image-engines',
  'list-text-to-image-logs','delete-text-to-image-log','create-ticket','list-tickets','get-ticket',
  'append-ticket-message','close-ticket',
];

export function coverageReport() {
  const have = new Set(Object.keys(actions));
  const missing = ORIGIN_ACTIONS.filter(a => !have.has(a));
  const extra = [...have].filter(a => !ORIGIN_ACTIONS.includes(a));
  return {
    originTotal: ORIGIN_ACTIONS.length,
    implemented: ORIGIN_ACTIONS.length - missing.length,
    missing,
    extra,
    totalHandlers: have.size,
  };
}
