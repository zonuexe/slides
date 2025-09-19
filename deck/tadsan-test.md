---
presentationID: 1DY5qiAsOK2_yNUyPaCj0lFnHOi_Ek8iFs8q_44RVC8s
title: これはテストでございます
defaults:
  - if: page == 1
    layout: front
  # Pages with only one title and one H2 heading use section layout
  - if: titles.size() == 1 && bodies.size() == 0
    layout: title-deka
  # Skip pages with TODO in speaker notes
  - if: speakerNote.contains("TODO")
    skip: true
  - if : titles.size() == 0 && bodies.size() > 0
    layout: basic-no-title
  # Default layout for all other pages
  - if: true
    layout: basic
---

## これはテストでございます

### This is my test presentation

---

## お前誰よ.

<!-- {"freeze":true,"layout":"self-introduction"} -->

 * うさみけんた / にゃんだーすわん
   * GitHub: [@zonuexe](https://github.com/zonuexe)
 * 2012年11月から現職
 * ピクシブ株式会社 Platform Div<br> > WebTechnology Team PHPer
 * 2012年末から現職、APIとかCIとかいろいろなとこ
   * 最近はインフラっぽい仕事してます
 * Emacs PHP Modeを開発しています (2017年-)
 * プログラミング言語にちょっとこだわりのある素人 (spcamp2010)

---

# おいこら

---

寿限無じゅげむ、寿限無じゅげむ、
五劫ごこうのすりきれ、
海砂利かいじゃり水魚すいぎょの、
水行末すいぎょうまつ・雲来末うんらいまつ・風来末ふうらいまつ、
食う寝るところに住むところ、
やぶらこうじのぶらこうじ、
パイポ・パイポ・パイポのシューリンガン、
シューリンガンのグーリンダイ、
グーリンダイのポンポコピーのポンポコナの、
長久命ちょうきゅうめいの長助ちょうすけ

---

# さよなら

さようなら

---

# こんにちは

ありがとう

---

# ゆあーん ゆよーん

ゆやゆよん

---
