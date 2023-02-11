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
    String loreText, loreTitle, loreTookRestText;
    public static String[] loreArray = new String[3]; //this will store the above Text data
    public static Random rand = new Random();

    public Lore(int chapter) {
// chapters (number of lores available in each chapter)
        int c1 = 3, c2 = 3, c3 = 3, c4 = 3;

        switch (chapter) {
            case 1: {
                int lorePicker = rand.nextInt(c1);//will pick numberLores + 1 (if numberLores = 2, generates = 0,1,2 => so 3 available/possible lores)
                if (lorePicker == 0) {
                    loreTitle = "The Green Air";
                    loreText = "You delve deeper into the Undercity, the green air becomes more prominent. You can't help\n"
                            + "but feel a sense of calm and peace amidst the chaos and danger. The smell of pollution is \n"
                            + "still present, but it's not as overwhelming as it once was. You've heard rumors about a rare\n"
                            + "type of plant that thrives in this toxic environment, and you can't help but wonder if that's \n"
                            + "what's responsible for the green air.\n "
                            + "- - - \n"
                            + "As you move through the dimly lit streets, you can't help but feel at ease. You're not sure if \n"
                            + "it's the green air or your training and determination, but you know that you're ready \n"
                            + "for whatever comes your way.";
                    loreTookRestText = "You know that the Undercity is a dangerous place, but you're not afraid. You've got \n"
                            + "your equipment and wits. You're determined to complete your mission and bring an end to the Kingpins.";
                    
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                    loreArray[2] = loreTookRestText;
                } else if (lorePicker == 1) {
                    loreTitle = "A Glimpse of Hope";
                    
                    loreText = "You come across a river that runs through the Undercity. At first glance, you expect it to be \n"
                            + "just as polluted and dirty as the rest of the environment, but you're surprised to see that it's not.\n"
                            + "The water is clear and there's a slight hint of blue in it. Fish can be seen swimming in the water\n"
                            + "and you can't help but feel a bit of hope in this harsh place.";
                    
                    loreTookRestText = "As you move forward, you can't help but feel grateful for this unexpected respite.\n"
                            + "The river serves as a reminder that even in the darkest of places, there is still beauty \n"
                            + "and hope to be found.";
                    
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                    loreArray[2] = loreTookRestText;
                } else if (lorePicker == 2) {
                    loreTitle = "A Glimpse of Hope";
                    
                    loreText = "You come across a river that runs through the Undercity. At first glance, you expect it to be \n"
                            + "just as polluted and dirty as the rest of the environment, but you're surprised to see that it's not.\n"
                            + "The water is clear and there's a slight hint of blue in it. Fish can be seen swimming in the water\n"
                            + "and you can't help but feel a bit of hope in this harsh place.";
                    
                    loreTookRestText = "As you move forward, you can't help but feel grateful for this unexpected respite.\n"
                            + "The river serves as a reminder that even in the darkest of places, there is still beauty \n"
                            + "and hope to be found.";
                    
                    loreArray[0] = loreTitle;
                    loreArray[1] = loreText;
                    loreArray[2] = loreTookRestText;
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
