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

    // MAYBE TODOS
    // MIGHT NOT need the loreArray[]
    // -add an outro to the intro after the player takes a rest
    
    
    
    int chapter;
    String loreText, loreTitle, result;
    public static String[] loreArray = new String[2];
    public static Random rand = new Random();

    public Lore(int chapter) {
// chapters (number of lores available in each chapter
        int c1 = 3, c2 = 3, c3 = 3, c4 = 3;

        switch (chapter) {
            case 1: {
                int numberLores = c1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {
                    loreTitle = "This is a Title 1 0";
                    loreText = "1 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                } else if (lorePicker == 1) {
                    loreTitle = "This is a Title 1 1";
                    loreText = "1 1 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                } else if (lorePicker == 2){
                    loreTitle = "This is a Title 1 2";
                    loreText = "1 2 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                }
                break;
            }
            case 2: {
                int numberLores = c2 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {
                    loreTitle = "This is a Title 2 0";
                    loreText = "2 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                } else if (lorePicker == 1) {
                    loreTitle = "This is a Title 2 1";
                    loreText = "2 1 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;

                    loreArray[1] = loreText;
                } else {

                    loreTitle = "This is a Title 2 2";
                    loreText = "2 2 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                }
                break;
            }

            case 3: {
                int numberLores = c3 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {

                    loreTitle = "This is a Title 3 0";
                    loreText = "3 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;

                    loreArray[1] = loreText;
                } else if (lorePicker == 1) {
                    loreTitle = "This is a Title 3 1";
                    loreText = "3 1 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                } else {

                    loreTitle = "This is a Title 3 2";

                    loreText = "3 2 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";

                    loreArray[0] = loreTitle;

                    loreArray[1] = loreText;
                }
                break;
            }

            case 4: {
                int numberLores = c4 - 1; // if c1 is 3, numberLores is 2, so the lorePicker will generate 0 or 1 or 2 (total of three possible outcomes (c1))
                int lorePicker = rand.nextInt(numberLores);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {

                    loreTitle = "This is a Title 4 0";
                    loreText = "4 0 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";

                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                } else if (lorePicker == 1) {
                    loreTitle = "This is a Title 4 1";
                    loreText = "4 1 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                } else {

                    loreTitle = "This is a Title 4 2";
                    loreText = "4 2 This is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore \nthis is a lore this is a lore this is a lore";
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                }
                break;
            }
            default:
                break;
        }
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



}
