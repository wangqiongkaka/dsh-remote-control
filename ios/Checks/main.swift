// Run: swiftc ios/DSHRemote/PairingLink.swift ios/Checks/main.swift -o "$TMPDIR/pairing-check" && "$TMPDIR/pairing-check"

import Foundation

let accepted = [
  ("https://dsh.example.com/?pair=abc_DEF-123", "https://dsh.example.com/"),
  ("  https://203.0.113.10:8443/?pair=x\n", "https://203.0.113.10:8443/"),
  ("https://[2001:db8::1]/?pair=x", "https://[2001:db8::1]/"),
]
for (link, origin) in accepted {
  precondition(pairingOrigin(link)?.absoluteString == origin, "should accept \(link)")
}

let refused = [
  "http://dsh.example.com/?pair=x",          // Secure cookie needs HTTPS
  "https://dsh.example.com/",                // no token
  "https://dsh.example.com/?pair=",          // empty token
  "https://dsh.example.com/?pair=x&a=1",     // proxy refuses extra parameters
  "https://dsh.example.com/?pair=x&pair=y",
  "https://dsh.example.com/s?pair=x",        // pairing only happens at the root
  "https://dsh.example.com?pair=x",
  "https://dsh.example.com/?pair=x#f",
  "https://u:p@dsh.example.com/?pair=x",
  "dsh.example.com/?pair=x",
  "not a link",
]
for link in refused {
  precondition(pairingOrigin(link) == nil, "should refuse \(link)")
}

let home = URL(string: "https://dsh.example.com/")!
precondition(sameOrigin(URL(string: "https://dsh.example.com/api/x?y=1")!, home))
precondition(!sameOrigin(URL(string: "https://dsh.example.com:8443/")!, home))
precondition(!sameOrigin(URL(string: "https://github.com/")!, home))
precondition(sessionLinkId(URL(string: "dshremote://session/01JABC-def_9.x:y")!) == "01JABC-def_9.x:y")
for link in ["dshremote://session/", "dshremote://session/a%22b", "dshremote://session/a/b", "dshremote://session/a?x=1",
             "dshremote://other/a", "https://session/a", "dshremote://session/a');alert(1)//"] {
  precondition(URL(string: link).flatMap(sessionLinkId) == nil, "should refuse \(link)")
}
print("pairing link checks passed")
