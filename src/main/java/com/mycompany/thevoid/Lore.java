/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Random;

/**
 *
 * @author jihad
 */
public class Lore {

    static int chapter;
    static String loreText, loreTitle, result;
    public static String[] loreArray = new String[2];
    static String playerName = GameLogic.player.name;
    public static Random rand = new Random();

    public Lore(int chapter, String loreText, String loreTitle) {
        this.chapter = chapter;
        this.loreText = loreText;
        this.loreTitle = loreTitle;
    }

    public static String[] loreGen(int chapter) {

        // chapters (number of lores available in each chapter
        int c1 = 3, c2 = 3, c3 = 3, c4 = 3;

    static  
    this.chapter  = chapter;

    switch (chapter) {
        case 1: {
            int numberLores = c1 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
            int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
            if (lorePicker == 0) {
     
    static this.loreTitle = "This is a Title 1 0";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else if (lorePicker

    == 1) {
    static  
    this.loreTitle  = "This is a Title 1 1";
    static  
    this.loreText  = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
    static  
    this.loreArray 
    [0] = this.loreTitle ;
    static  
    this.loreArray 
    [1] = this.loreText ;
}
else {
                    static this.loreTitle = "This is a Title 1 2";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                }
                break;
            }
            case 2: {
                int numberLores = c2 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {
                    static this.loreTitle = "This is a Title 2 0";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else if (lorePicker == 1) {
                    static this.loreTitle = "This is a Title 2 1";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else {
                    static this.loreTitle = "This is a Title 2 2";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                }
                break;
            }
            case 3: {
                int numberLores = c3 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {
                    static this.loreTitle = "This is a Title 3 0";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else if (lorePicker == 1) {
                    static this.loreTitle = "This is a Title 3 1";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else {
                    static this.loreTitle = "This is a Title 3 2";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                }
                break;
            }
            case 4: {
                int numberLores = c4 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {
                    static this.loreTitle = "This is a Title 4 0";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else if (lorePicker == 1) {
                    static this.loreTitle = "This is a Title 4 1";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                } else {
                    static this.loreTitle = "This is a Title 4 2";
                    static this.loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    static this.loreArray[0] = this.loreTitle;
                    static this.loreArray[1] = this.loreText;
                }
                break;
            }
            default:
                break;
        }

        return loreArray;
    }

    public int getChapter() {
        return chapter;
    }

    public void setChapter(int chapter) {
        this.chapter = chapter;
    }

    public String getLoreText() {
        return loreText;
    }

    public void setLoreText(String loreText) {
        this.loreText = loreText;
    }

    public String getLoreTitle() {
        return loreTitle;
    }

    public void setLoreTitle(String loreTitle) {
        this.loreTitle = loreTitle;
    }

    @Override
public String toString() {
        return "Lore{" + "loreText=" + loreText + ", loreTitle=" + loreTitle + ", playerName=" + playerName + '}';
    }

}
