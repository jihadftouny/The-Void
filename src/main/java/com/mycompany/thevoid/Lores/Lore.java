/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid.Lores;

import java.util.ArrayList;
import java.util.Random;

/**
 *
 * @author jihad
 */
public abstract class Lore {

    private static Random rand = new Random();
    public static ArrayList<LorePiece> mLoreChapter = new ArrayList<LorePiece>();

    /**
     * Run a random exercise
     * @return 
     */
    public static String[] runRandom() {
        int i = rand.nextInt(mLoreChapter.size());
        return mLoreChapter.get(i).run();
    }
}
