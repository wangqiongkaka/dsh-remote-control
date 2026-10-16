// Run: swiftc ios/DSHRemote/PairingLink.swift ios/Checks/main.swift -o "$TMPDIR/pairing-check" && "$TMPDIR/pairing-check"

import Foundation

let accepted = [
  ("https://mac.tail1234.ts.net/?pair=abc_DEF-123", "https://mac.tail1234.ts.net/"),
  ("  https://203.0.113.10:8443/?pair=x\n", "https://203.0.113.10:8443/"),
  ("https://[2001:db8::1]/?pair=x", "https://[2001:db8::1]/"),
]
for (link, origin) in accepted {
  precondition(pairingOrigin(link)?.absoluteString == origin, "should accept \(link)")
}

let refused = [
  "http://mac.ts.net/?pair=x",          // Secure cookie needs HTTPS
  "https://mac.ts.net/",                // no token
  "https://mac.ts.net/?pair=",          // empty token
  "https://mac.ts.net/?pair=x&a=1",     // proxy refuses extra parameters
  "https://mac.ts.net/?pair=x&pair=y",
  "https://mac.ts.net/s?pair=x",        // pairing only happens at the root
  "https://mac.ts.net?pair=x",
  "https://mac.ts.net/?pair=x#f",
  "https://u:p@mac.ts.net/?pair=x",
  "mac.ts.net/?pair=x",
  "not a link",
]
for link in refused {
  precondition(pairingOrigin(link) == nil, "should refuse \(link)")
}

let home = URL(string: "https://mac.ts.net/")!
precondition(sameOrigin(URL(string: "https://mac.ts.net/api/x?y=1")!, home))
precondition(!sameOrigin(URL(string: "https://mac.ts.net:8443/")!, home))
precondition(!sameOrigin(URL(string: "https://github.com/")!, home))
print("pairing link checks passed")
