/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Random;
import jdk.nashorn.internal.codegen.CompilerConstants;

/**
 *
 * @author jihad
 */
/**
 * the game is going to run on a dice system (for its battle), so there will be
 * different amounts of dice, of various sizes. for example, 2d6, 3d8, 1d20, etc
 *
 * MAYBE Object concept is not necessary
 */
public class Dice {

    public int quantity, sides; //sides can be 2,4,6,8,10,12,20
//    public int totalRoll, currentRoll;

    public Dice(int quantity, int sides) {
        this.quantity = quantity;
        this.sides = sides;
    }

    
    

    public static int rollDice(Dice dice) {
        Random rand = new Random();
        int totalRoll = 0;
        
        for (int i = 0; i < dice.quantity; i++) {

            int currentRoll = 1 + rand.nextInt(dice.sides);
            
            totalRoll += currentRoll;
            System.out.println("current roll " + currentRoll);
        }
        System.out.println("total roll " + totalRoll);
        return totalRoll;

    }

}
