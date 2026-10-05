# 開発

開発にはNode.js 20以降が必要です。npmの依存パッケージはありません。

```sh
npm test         # PDF生成とページ追加の単体テスト
npm run build    # build/zotero-handwritten-notes-<バージョン>.xpi と build/updates.json を生成
```

## ソースから動かす

普段使うライブラリを壊さないよう、開発用のプロファイルとデータディレクトリを別に用意してください（`zotero -P`）。

1. Zoteroを終了する
2. Zoteroプロファイルの `extensions` ディレクトリに `handwritten-notes@acavalkyrie.github.io` という名前のファイルを作り、中身にこのリポジトリの `addon` ディレクトリの絶対パスを書く
3. Zoteroを起動する

## ファイル構成

```text
addon/
├── manifest.json, bootstrap.js
├── content/
│   ├── pdf-core.js               # 罫線の描画、PDF生成、増分更新によるページ追加
│   ├── handwritten-notes.js      # Zoteroのメニュー、添付ファイルの処理、ファイルの置き換え
│   └── paper-style-dialog.*      # 用紙選択ダイアログ
├── locale/{en-US,ja-JP}/         # Fluentの文言
└── vendor/pdf-lib.min.js         # pdf-lib 1.17.1（MIT）
scripts/
├── build.mjs                     # 依存なしのXPIビルド
├── make-samples.js, verify-pypdf.py   # pypdfによる任意の照合
test/                             # node:testの単体テスト
```

## リリース

`addon/manifest.json` の `version` を上げてコミットし、`v<バージョン>` のタグをpushします。GitHub ActionsがXPIと `updates.json` をビルドし、GitHubのリリースに添付します。プラグインの `update_url` は `releases/latest/download/updates.json` を指しています。
