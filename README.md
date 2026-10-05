# Zotero Handwritten Notes

Zotero 10用のプラグインで、ライブラリの各論文に手書きノート用のPDFを添付します。PCで論文を読み、同じ論文に紐付いたノートにiPadとApple Pencilで書き込めます。手書きの内容はZoteroのInk注釈として同期されます。

## 機能

- 論文アイテムに手書きノート用PDFを作成し、子添付ファイルとして登録する
- 用紙は白紙、6 mmの横罫、5 mmの方眼から選べる
- 既存のZotero注釈を壊さずに、同じ用紙のページを末尾に追加できる
- iPadとApple Pencilでの利用を前提にしている

## 動作環境とインストール

動作にはZotero 10.xのデスクトップ版（Windows、macOS、Linux）が必要です。iPadで書く場合は、iOS/iPadOS版Zoteroを用意し、データとファイルの両方のZotero Syncを設定してください。プラグインが動くのはデスクトップ版だけで、iPadには何もインストールしません。

1. [最新リリース](https://github.com/acaValkyrie/zotero-handwritten-notes/releases/latest)から `zotero-handwritten-notes-<バージョン>.xpi` をダウンロードする
2. Zoteroで「ツール → プラグイン」を開く
3. `.xpi` をプラグイン画面にドラッグするか、歯車メニューからファイルを指定してインストールする

以降の更新は、Zoteroがリリースを自動で確認します。

## 使い方

### ノートを作る

1. 通常のアイテム（学術誌論文、会議論文、プレプリント、学位論文など）を1件だけ選んで右クリックする
2. 「手書きノートを作成」を選ぶ
3. 用紙を選んで「作成」を押す

そのアイテムの子添付ファイルとして、A4で1ページの `Handwritten Notes.pdf` が追加されます。

```text
論文アイテム
├── paper.pdf
└── Handwritten Notes.pdf
```

同じ名前の添付ファイルが既にある場合は、`Handwritten Notes 2.pdf`、`Handwritten Notes 3.pdf` のように番号を付けます。既存のファイルを上書きすることはありません。

同期したら、iPadで `Handwritten Notes.pdf` を開き、インクツールで書き込みます。手書きはZoteroのInk注釈として保存され、他の注釈と同じように同期されます。

### ページを追加する

1. PCのZoteroでノートのPDFを右クリックする
2. 「ページを追加」を選ぶ

作成時と同じ用紙のページが末尾に1ページ追加されます。もう一度同期すると、iPadにも新しいページが現れます。

「ページを追加」は、このプラグイン以外で作られたPDFにも使えます。その場合は用紙の種類が分からないので、用紙を選ぶ画面が表示されます。

## 用紙の種類

どの用紙もA4縦（210 mm × 297 mm）です。罫線は画像ではなく細く薄い色のベクター線で描くので、拡大してもにじまず、ファイルも小さく済みます。

| 用紙 | 内容 | 線の間隔 |
| --- | --- | --- |
| 白紙 | 何も描かない空のページ | — |
| 横罫 — 6 mm | 横線のみ | 6 mm |
| 方眼 — 5 mm | 縦横の線で正方形のマス目 | 5 mm × 5 mm |

罫線は上下左右に10 mmの余白を取って描きます。1 mm = 72 / 25.4 ptで換算し、整数に丸めずに配置するので、間隔は正確に6 mm・5 mmになります。A4以外のPDFにページを追加した場合も、物理的な間隔は変わりません。

## 仕組み

ページ追加では元のPDFを一切書き換えず、末尾に追記するだけなので、既存のページと注釈はそのまま残ります。

- **ノートの作成**: [pdf-lib](https://github.com/Hopding/pdf-lib) でPDFを生成し、Zotero管理下の添付ファイル（Stored Attachment）として登録します。そのためZoteroのファイル同期の対象になります。
- **用紙の記録**: 用紙の種類はPDF内部の文書情報（`/ZoteroHandwrittenNotesPaperStyle`）に記録します。ファイルと一緒に同期されるので別のPCでも用紙を判定でき、アイテムの書誌情報には触れません。
- **ページの追加**: PDFの増分更新（incremental update）を使います。元のファイルは1バイトも変えず、その後ろに新しいページ、更新したページツリー、新しい相互参照表を追記します。既存ページの再生成、再レンダリング、サイズ変更、回転、並べ替えはしません。
- **注釈の扱い**: Zoteroの注釈はページ番号と紐付けてZoteroのデータベースに保存されています。末尾に追加しても既存ページの番号は変わらず、プラグインが注釈をコピー・移動・PDFへの焦き付けをすることもありません。
- **追加ページの大きさ**: 直前の最終ページと同じMediaBoxとCropBoxを使います。最終ページが回転している場合は、見た目の大きさをそろえた回転なしのページにして、罫線の向きが崩れないようにします。
- **置き換え前の検証**: 結果をいったん一時ファイルに書き、読み戻して次の点を確かめます。
  - 元のバイト列がそのまま残っている
  - 新しい相互参照表の位置がすべて正しい
  - ページ数がちょうど1増えている
  - 既存ページのオブジェクトが差し替わっていない
- **失敗したとき**: どれか1つでも失敗した場合や、処理中にファイルが別のプログラムに更新された場合は、元のPDFには手を付けません。暗号化されたPDFと、相互参照表を確実に特定できないPDFも、変更せずに断ります。
- **置き換えたあと**: Zotero本体がPDFのページを回転するときと同じ手順でZoteroに変更を伝えます。添付ファイルをアップロード対象にし、開いているリーダーを再読み込みし、全文検索の索引も作り直します。

## 同期の動作と互換性

普段同期されるのは注釈だけで、PDFファイル自体が同期されるのはページを追加したときだけです。

```text
普段:         Apple Pencil → Ink注釈 → Zoteroのデータ同期
ページ追加時: ページを追加 → PDFファイル更新 → Zoteroのファイル同期 → iPadが新しいファイルを取得
```

ページは必ずPCで追加し、新しいファイルがiPadに同期されてから、iPadでそのページに書いてください。

| 環境 | 対応 |
| --- | --- |
| Zotero 10.x デスクトップ版（Windows、macOS、Linux） | 対応 |
| Zotero 9.x以前 | 非対応 |
| Zoteroのベータ版・ナイトリー版、Zotero 11以降 | 未検証 |
| iOS/iPadOS版Zotero | プラグインは入れず、同期されたPDFと注釈を使う |

## 開発

開発にはNode.js 20以降が必要です。npmの依存パッケージはありません。

```sh
npm test         # PDF生成とページ追加の単体テスト
npm run build    # build/zotero-handwritten-notes-<バージョン>.xpi と build/updates.json を生成
```

ソースから動かす手順は次のとおりです。普段使うライブラリを壊さないよう、開発用のプロファイルとデータディレクトリを別に用意してください（`zotero -P`）。

1. Zoteroを終了する
2. Zoteroプロファイルの `extensions` ディレクトリに `handwritten-notes@acavalkyrie.github.io` という名前のファイルを作り、中身にこのリポジトリの `addon` ディレクトリの絶対パスを書く
3. Zoteroを起動する

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

リリースでは、`addon/manifest.json` の `version` を上げてコミットし、`v<バージョン>` のタグをpushします。GitHub ActionsがXPIと `updates.json` をビルドし、GitHubのリリースに添付します。プラグインの `update_url` は `releases/latest/download/updates.json` を指しています。

## ライセンス

[MIT](LICENSE)。[pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1（© Andrew Dillon、MITライセンス、[addon/vendor/pdf-lib.LICENSE.md](addon/vendor/pdf-lib.LICENSE.md)）を同梱しています。
