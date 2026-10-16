import Foundation

/// The DSH Web origin a desktop pairing link opens, or nil unless the link has the exact shape
/// the pairing proxy admits: `https://host[:port]/?pair=<token>` and nothing else. The link is
/// loaded unchanged; only this origin is kept, never the token.
func pairingOrigin(_ text: String) -> URL? {
  guard let link = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
        let parts = URLComponents(url: link, resolvingAgainstBaseURL: false),
        parts.scheme == "https", parts.host?.isEmpty == false,
        parts.user == nil, parts.password == nil, parts.fragment == nil, parts.path == "/",
        let query = parts.queryItems, query.count == 1, query[0].name == "pair", query[0].value?.isEmpty == false
  else { return nil }
  return URL(string: "/", relativeTo: link)?.absoluteURL
}

/// Same scheme, host and port: a navigation that stays inside the paired DSH Web.
func sameOrigin(_ a: URL, _ b: URL) -> Bool {
  a.scheme == b.scheme && a.host == b.host && a.port == b.port
}
