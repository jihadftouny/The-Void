/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid.Lores;

/**
 *
 * @author jihad
 */
public class ChapterOneLore extends Lore {

    public ChapterOneLore() {

        class SomeLore implements LorePiece {
            @Override
            public String[] run() {

                String[] mRes = new String[2];
                mRes[0] = "Question type 1";
                mRes[1] = "Answer type 1";
                return mRes;
            }

        }

        class SomeOtherLore implements LorePiece {
            @Override
            public String[] run() {

                String[] mRes = new String[2];
                mRes[0] = "Question type 2";
                mRes[1] = "Answer type 2";
                return mRes;
            }

        }
        SomeLore mN = new SomeLore();
        SomeOtherLore mS = new SomeOtherLore();

        mLoreChapter.add(mN);
        mLoreChapter.add(mS);
    }
}
