// イベント名から「シリーズ (グループ)」をヒューリスティックに導出する。
// slides/*.yaml は変更せず、ビルド時に event.name から計算するのが前提。
// 規則で判定しきれない例外だけ OVERRIDES (名前 → グループ) で上書きする。
//
// 代表的な規則:
//   - 「PHPカンファレンス20XX」(地域名なし) → "PHP Conference Japan" に集約
//   - 「PHPカンファレンス<地域>…」          → "PHPカンファレンス<地域>" に集約 (年・前夜祭・懇親会・非公式を畳む)
//   - その他の連続開催イベント (PHPerKaigi / PHP勉強会＠東京 / PHP BLT / Learn Languages …) も系列化
//   - どの系列にも当てはまらない単発イベントは、その名前自体を 1 グループとして扱う (isSeries:false)

// PHPカンファレンスの地域版で扱う地域名。データに存在する地域に加え、
// 既知の地方版ブランドを少しだけ前倒しで載せておく (新地域の追加はこの 1 行で済む)。
const PHP_CONFERENCE_REGIONS = {
  北海道: "hokkaido",
  東北: "tohoku",
  仙台: "sendai",
  関東: "kanto",
  名古屋: "nagoya",
  関西: "kansai",
  北陸: "hokuriku",
  福井: "fukui",
  広島: "hiroshima",
  香川: "kagawa",
  四国: "shikoku",
  愛媛: "ehime",
  福岡: "fukuoka",
  沖縄: "okinawa",
  小田原: "odawara",
};

const PHP_CONFERENCE_PREFIX = "PHPカンファレンス";

// 名前先頭の非公式マーカー ((非公式) / 【非公式】 など) を判定用に取り除く。
// 例: "(非公式)PHPカンファレンス沖縄2023前夜祭LT会" → "PHPカンファレンス沖縄2023前夜祭LT会"
function stripUnofficialPrefix(name) {
  return name.replace(/^\s*[（(【［[]?\s*非公式\s*[）)】］\]]?\s*/u, "").trim();
}

function matchPhpConference(stripped) {
  if (!stripped.startsWith(PHP_CONFERENCE_PREFIX)) return null;
  const rest = stripped.slice(PHP_CONFERENCE_PREFIX.length).replace(/^\s+/, "");

  for (const [region, slug] of Object.entries(PHP_CONFERENCE_REGIONS)) {
    if (rest.startsWith(region)) {
      return { id: `phpcon-${slug}`, name: `${PHP_CONFERENCE_PREFIX}${region}`, isSeries: true };
    }
  }

  // 地域名が付かず年 (または何も) から始まる → 全国版 (現 PHP Conference Japan)。
  if (rest === "" || /^\d{4}/.test(rest)) {
    return { id: "php-conference-japan", name: "PHP Conference Japan", isSeries: true };
  }

  return null;
}

// PHPカンファレンス以外の連続開催イベントの系列規則 (上から順に評価)。
const SERIES_RULES = [
  { test: /^PHPerKaigi/, id: "phperkaigi", name: "PHPerKaigi" },
  { test: /PHP勉強会＠東京/, id: "php-benkyokai-tokyo", name: "PHP勉強会＠東京" },
  { test: /^PHP BLT/, id: "php-blt", name: "PHP BLT" },
  { test: /Learn Languages/, id: "learn-languages", name: "LLイベント" },
  { test: /^TechFeed Experts ?Night/, id: "techfeed-experts-night", name: "TechFeed Experts Night" },
  { test: /^pixiv.*BOOT CAMP/i, id: "pixiv-boot-camp", name: "pixiv BOOT CAMP" },
  { test: /^ピクシブ社内勉強会/, id: "pixiv-shanai-benkyokai", name: "ピクシブ社内勉強会" },
  { test: /^Open Developers Conference/, id: "odc", name: "ODC" },
];

// 併催 (イベント内イベント) による二重所属。あるグループに属するイベントは、
// ここに列挙したグループにも所属する。例: LLイベントは ODC 併催。
const CO_MEMBERSHIPS = {
  "learn-languages": ["odc"],
};

// 規則で判定しきれない・規則とは別扱いにしたい例外を名前ごとに上書きする。
const OVERRIDES = new Map([
  // PHPカンファレンス2023 のリジェクトコンだが主催は Cybozu Tech Meetup (#22) の連続開催枠。
  // 公式の PHP Conference Japan とは別物なので Cybozu Tech Meetup 系列として扱う。
  // (PHP Conference Japan に畳みたい場合は id/name を php-conference-japan / "PHP Conference Japan" へ)
  [
    "【Cybozu Tech Meetup #22】PHPカンファレンス 2023 リジェクトコン",
    { id: "cybozu-tech-meetup", name: "Cybozu Tech Meetup", isSeries: true },
  ],
]);

// 1 件のイベント名 → 所属グループ。判定できなければ単発グループ (isSeries:false) を返す。
export function groupEvent(rawName) {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return null;

  if (OVERRIDES.has(name)) return OVERRIDES.get(name);

  const stripped = stripUnofficialPrefix(name);

  const phpConference = matchPhpConference(stripped);
  if (phpConference) return phpConference;

  for (const rule of SERIES_RULES) {
    if (rule.test.test(stripped)) {
      return { id: rule.id, name: rule.name, isSeries: true };
    }
  }

  // どの系列にも当てはまらない単発イベント。イベント名自体を 1 グループとして扱う。
  return { id: `solo:${name}`, name, isSeries: false };
}

function seriesGroupById(id) {
  const rule = SERIES_RULES.find((entry) => entry.id === id);
  return rule ? { id: rule.id, name: rule.name, isSeries: true } : null;
}

// 1 件のイベント名 → 所属する全グループ。先頭が主グループ、続いて併催グループ。
export function groupEvents(rawName) {
  const primary = groupEvent(rawName);
  if (!primary) return [];
  const groups = [primary];
  for (const id of CO_MEMBERSHIPS[primary.id] ?? []) {
    if (groups.some((group) => group.id === id)) continue;
    const def = seriesGroupById(id);
    if (def) groups.push(def);
  }
  return groups;
}

// スライド一覧からグループを集計する。
// 返り値: [{ id, name, isSeries, events: [{ name, slug, title, presented_at }] }]
//   - グループ内は presented_at 昇順
//   - グループは所属イベント数の多い順 → 名前順
export function buildEventGroups(slides) {
  const groups = new Map();

  for (const slide of Array.isArray(slides) ? slides : []) {
    const events = Array.isArray(slide?.events) ? slide.events : [];
    for (const event of events) {
      const name = typeof event?.name === "string" ? event.name : "";
      const entry = {
        name,
        slug: typeof slide?.slug === "string" ? slide.slug : "",
        title: typeof slide?.title === "string" ? slide.title : "",
        presented_at: typeof event?.presented_at === "string" ? event.presented_at : "",
      };

      // 主グループ + 併催グループ。同じ発表が複数グループに所属しうる。
      for (const group of groupEvents(name)) {
        if (!groups.has(group.id)) {
          groups.set(group.id, {
            id: group.id,
            name: group.name,
            isSeries: group.isSeries,
            events: [],
          });
        }
        groups.get(group.id).events.push({ ...entry });
      }
    }
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.events.sort((a, b) => (a.presented_at || "").localeCompare(b.presented_at || ""));
  }
  list.sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name));
  return list;
}
