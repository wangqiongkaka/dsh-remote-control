/**
 * Account & balance for the remote page.
 *
 * The Host registers its account section in the Desktop renderer only, although the account calls
 * behind it serve any page. A page that came through the proxy therefore gets this read-only
 * section over the same calls: who is signed in, the wallet balances and the Platform usage page.
 * Signing in and out and topping up stay on the Desktop app, whose sign-in flow expects its own
 * window. Each call reports the Host's client version (served by this plugin's control route), the
 * same identity the Host's own client sends; without it the section stays away.
 */

import { useSyncExternalStore, type CSSProperties } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'

interface Wallet { currency: 'CNY' | 'USD'; balance: string }
interface Profile { name: string | null; contact: string | null; avatarUrl?: string | null }
type ProfileRead = { status: 'ready'; value: Profile } | { status: 'failed' }
type BalanceRead = { status: 'ready'; value: readonly Wallet[]; bonusWallets: readonly Wallet[] } | { status: 'failed' }
interface AccountView { status: 'signed-out' | 'credential-stored'; links: { usageUrl: string } }
interface ClientMetadata { version: string; locale: string; timezoneOffsetSeconds: number }
type Outcome<T> = { ok: true; value: T | null } | { ok: false }

/** The Host's account Remote and stream supervisor, as far as this section reads them. */
export interface AccountRemote {
  /** The Host's `remote.account` namespace; absent where the Host serves none. */
  account: {
    watch(signal: AbortSignal): AsyncIterable<AccountView>
    getProfile(client: ClientMetadata): Promise<Outcome<ProfileRead>>
    getBalance(client: ClientMetadata): Promise<Outcome<BalanceRead>>
  } | undefined
  $stream<T>(options: { name: string; open: (signal: AbortSignal) => AsyncIterable<T>; ended: (accepted: boolean) => Error }):
    AsyncIterable<{ value: T; accept(): void }> & { dispose(): Promise<void> }
}

/** Slot ledger calls this section makes; method syntax keeps the frame registry assignable. */
export interface SectionSlots {
  inject(key: string, callback: () => () => void): () => void
  register(options: object, component: unknown): () => void
}

/** What the section shows: present only while an account is signed in. */
export interface AccountSnapshot {
  usageUrl: string
  profile?: ProfileRead
  balance?: BalanceRead
}

/** Observable account snapshot handed to the section. */
export interface AccountStore {
  getSnapshot(): AccountSnapshot | undefined
  subscribe(listener: () => void): () => void
}

/**
 * Format a Platform decimal string the way the Desktop account section does: two decimals rounded
 * down, thousands separators, and `<¥0.01` for a positive amount below one cent.
 * @param amount - decimal string with the server's precision.
 * @param symbol - currency symbol.
 * @returns the display amount.
 */
export function formatBalance(amount: string, symbol: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/u.exec(amount.trim())
  if (match === null) return symbol + amount
  const [, sign, digits = '0', fraction = ''] = match
  const whole = digits.replace(/^0+(?=\d)/u, '')
  const cents = (fraction + '00').slice(0, 2)
  if (whole === '0' && /^0*$/u.test(fraction)) return `${symbol}0.00`
  if (whole === '0' && cents === '00') return sign === '' ? `<${symbol}0.01` : `-${symbol}0.01`
  return `${sign}${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${cents}`
}

const symbolOf = (wallet: Wallet): string => wallet.currency === 'CNY' ? '¥' : '$'

/**
 * Follow the signed-in account and keep its section registered while one is.
 * @param deps - slot ledger, account Remote, active UI language, the Host's client version and
 * the section's translated nav label.
 * @returns a disposer that ends the stream and drops the section.
 */
export function phoneAccount(deps: {
  slots: SectionSlots
  remote: AccountRemote
  locale: () => string
  version: () => Promise<string | undefined>
  label: () => string
}): () => void {
  let snapshot: AccountSnapshot | undefined
  const listeners = new Set<() => void>()
  const store: AccountStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: AccountSnapshot | undefined): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  let declared = false
  let unregister: (() => void) | undefined
  const sync = (): void => {
    const wanted = declared && snapshot !== undefined
    if (wanted && unregister === undefined) {
      unregister = deps.slots.register({
        name: 'settings.section', id: 'account', order: -10, label: deps.label, locale: NS,
        inject: () => ({ store }),
      }, PhoneAccountSection)
    } else if (!wanted && unregister !== undefined) {
      unregister()
      unregister = undefined
    }
  }
  const offInject = deps.slots.inject('settings.section', () => {
    declared = true
    sync()
    return () => { declared = false; sync() }
  })
  let disposed = false
  let stream: { dispose(): Promise<void> } | undefined
  void (async () => {
    const version = await deps.version().catch(() => undefined)
    if (disposed || version === undefined) return
    const client = (): ClientMetadata => ({
      version, locale: deps.locale(),
      // Date.getTimezoneOffset reports minutes west of UTC; Platform wants seconds east.
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
    const { account } = deps.remote
    if (account === undefined) return
    const frames = deps.remote.$stream<AccountView>({
      name: 'remote-control account', open: signal => account.watch(signal),
      ended: () => new Error('account stream ended'),
    })
    stream = frames
    let generation = 0
    for await (const frame of frames) {
      frame.accept()
      const current = ++generation
      if (frame.value.status !== 'credential-stored') {
        publish(undefined)
        sync()
        continue
      }
      publish({ usageUrl: frame.value.links.usageUrl })
      sync()
      /** A read that fails, or lands after a newer frame, leaves the rest of the snapshot alone. */
      const read = async <K extends 'profile' | 'balance'>(field: K,
        call: () => Promise<Outcome<NonNullable<AccountSnapshot[K]>>>): Promise<void> => {
        let value: AccountSnapshot[K] | null
        try {
          const result = await call()
          value = result.ok ? result.value : { status: 'failed' }
        } catch {
          value = { status: 'failed' }
        }
        if (current === generation && snapshot !== undefined && value !== null) publish({ ...snapshot, [field]: value })
      }
      void read('profile', () => account.getProfile(client()))
      void read('balance', () => account.getBalance(client()))
    }
  })().catch(() => { if (!disposed) { publish(undefined); sync() } })
  return () => {
    disposed = true
    offInject()
    unregister?.()
    unregister = undefined
    void stream?.dispose()
  }
}

const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' },
  card: {
    display: 'flex', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16,
    border: '0.5px solid var(--dsw-alias-border-l3)',
  },
  avatar: {
    flex: 'none', width: 40, height: 40, borderRadius: 20, objectFit: 'cover',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600,
    color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)',
  },
  identity: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  name: { fontSize: 15, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
  secondary: {
    fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  balance: { display: 'flex', flexDirection: 'column', padding: '4px 16px', borderRadius: 16, border: '0.5px solid var(--dsw-alias-border-l3)' },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44,
    fontSize: 14, color: 'var(--dsw-alias-label-primary)',
  },
  divider: { height: 0.5, background: 'var(--dsw-alias-border-l3)' },
  amount: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontVariantNumeric: 'tabular-nums', fontWeight: 500 },
  link: { color: 'var(--dsw-alias-state-business-primary)', textDecoration: 'none', fontSize: 14 },
  hint: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
} satisfies Record<string, CSSProperties>

/** Section props: the plugin dictionary and the injected account store. */
export type PhoneAccountSectionProps = PropsLocale<typeof NS> & InjectFace<{ store: AccountStore }>

/**
 * Render the signed-in identity, the wallet balances and the Platform usage link.
 * @param props - translation and the account store.
 * @returns the section, or nothing once the account signs out.
 */
export function PhoneAccountSection({ t, store }: PhoneAccountSectionProps): React.JSX.Element | null {
  const account = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (account === undefined) return null
  const profile = account.profile?.status === 'ready' ? account.profile.value : undefined
  const name = profile?.name ?? t('accountSignedIn')
  const detail = profile?.contact ?? t(account.profile === undefined ? 'accountLoading' : 'accountUnavailable')
  const amounts = (wallets: readonly Wallet[]) => (
    <span style={styles.amount}>
      {wallets.map(wallet => <span key={wallet.currency}>{formatBalance(wallet.balance, symbolOf(wallet))}</span>)}
    </span>
  )
  const balance = account.balance
  const bonus = balance?.status === 'ready'
    // Only a positive bonus earns a row: no sign, and some nonzero digit.
    ? balance.bonusWallets.filter(wallet => !wallet.balance.startsWith('-') && /[1-9]/u.test(wallet.balance))
    : []
  const pending = <span style={styles.secondary}>{t(balance === undefined ? 'accountLoading' : 'accountUnavailable')}</span>
  return (
    <section style={styles.section} aria-label={t('account')}>
      <div style={styles.card}>
        {profile?.avatarUrl
          ? <img style={styles.avatar} src={profile.avatarUrl} alt="" />
          : <span style={styles.avatar} aria-hidden="true">{name.slice(0, 1)}</span>}
        <div style={styles.identity}>
          <span style={styles.name}>{name}</span>
          <span style={styles.secondary} role="status">{detail}</span>
        </div>
      </div>
      <div style={styles.balance}>
        <div style={styles.row}>
          <span>{t('accountBalance')}</span>
          {balance?.status === 'ready' && balance.value.length > 0 ? amounts(balance.value) : pending}
        </div>
        {bonus.length > 0 && <>
          <div style={styles.divider} />
          <div style={styles.row}>
            <span>{t('accountBonus')}</span>
            {amounts(bonus)}
          </div>
        </>}
        <div style={styles.divider} />
        <div style={styles.row}>
          <a style={styles.link} href={account.usageUrl} target="_blank" rel="noreferrer">{t('accountUsage')}</a>
        </div>
      </div>
      <p style={styles.hint}>{t('accountDesktopHint')}</p>
    </section>
  )
}
